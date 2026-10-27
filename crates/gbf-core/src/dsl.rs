/// Fast single-pass zero-regex DSL line classifier and action tokenizer.
///
/// Replaces up to 31 sequential regular expression evaluations per line in
/// `src/templates/dsl-compiler.ts` with a single-pass ASCII byte scanner.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DslFastToken {
    pub opcode: i32,
    pub arg1: i32,
    pub arg2: i32,
    pub arg3: i32,
    pub arg4: i32,
}

impl DslFastToken {
    #[inline]
    pub const fn skip() -> Self {
        Self { opcode: 0, arg1: 0, arg2: 0, arg3: 0, arg4: 0 }
    }

    #[inline]
    pub const fn fallback() -> Self {
        Self { opcode: -1, arg1: 0, arg2: 0, arg3: 0, arg4: 0 }
    }
}

/// Checks if a comment slice starts with the word `ensure` (case-insensitive).
#[inline]
fn is_ensure_comment(comment: &[u8]) -> bool {
    let trimmed = trim_ascii(comment);
    if trimmed.len() < 6 {
        return false;
    }
    if !trimmed[..6].eq_ignore_ascii_case(b"ensure") {
        return false;
    }
    trimmed.len() == 6 || !trimmed[6].is_ascii_alphanumeric()
}

#[inline]
fn trim_ascii(mut s: &[u8]) -> &[u8] {
    while let Some(&first) = s.first() {
        if first.is_ascii_whitespace() {
            s = &s[1..];
        } else {
            break;
        }
    }
    while let Some(&last) = s.last() {
        if last.is_ascii_whitespace() {
            s = &s[..s.len() - 1];
        } else {
            break;
        }
    }
    s
}

/// Splits a raw DSL line into `(clean_code, has_ensure_comment)`.
/// Note: If the line starts with `navigate`, `goto`, `click`, or `eval`, `#` and `//`
/// may be part of a URL or selector (`#quest/assist`), so we do not strip `#` or `//` for those.
fn strip_inline_comment(line: &[u8]) -> (&[u8], bool) {
    let trimmed = trim_ascii(line);
    if trimmed.is_empty() {
        return (&[], false);
    }
    if trimmed.starts_with(b"#") || trimmed.starts_with(b"//") {
        return (&[], false);
    }

    // Look for inline `#` or `//`
    let mut comment_start: Option<(usize, usize)> = None;
    let len = trimmed.len();
    let mut i = 0;
    while i < len {
        if trimmed[i] == b'#' {
            comment_start = Some((i, i + 1));
            break;
        }
        if i + 1 < len && trimmed[i] == b'/' && trimmed[i + 1] == b'/' {
            comment_start = Some((i, i + 2));
            break;
        }
        i += 1;
    }

    if let Some((code_end, c_start)) = comment_start {
        let code = trim_ascii(&trimmed[..code_end]);
        let comment = &trimmed[c_start..];
        let has_ensure = is_ensure_comment(comment);
        (code, has_ensure)
    } else {
        (trimmed, false)
    }
}

#[inline]
fn parse_u32_ascii(bytes: &[u8]) -> Option<u32> {
    if bytes.is_empty() {
        return None;
    }
    let mut val: u32 = 0;
    for &b in bytes {
        if !b.is_ascii_digit() {
            return None;
        }
        val = val.checked_mul(10)?.checked_add((b - b'0') as u32)?;
    }
    Some(val)
}

#[inline]
fn parse_score_ascii(bytes: &[u8]) -> Option<i32> {
    if bytes.is_empty() {
        return None;
    }
    let mut val: i32 = 0;
    let mut digits = 0;
    for &b in bytes {
        if b == b'_' || b == b',' {
            continue;
        }
        if !b.is_ascii_digit() {
            return None;
        }
        val = val.checked_mul(10)?.checked_add((b - b'0') as i32)?;
        digits += 1;
    }
    if digits > 0 { Some(val) } else { None }
}

/// Parses `c1s2`, `char 1 skill 2`, `character 1 s 2`, `skill 1-2`, `1-2`
/// and optional target `-> 3`, `target 3`, `ally 3`.
fn try_parse_skill(clean: &[u8], has_ensure: bool) -> Option<DslFastToken> {
    // Split into whitespace/punctuation tokens carefully
    let s = std::str::from_utf8(clean).ok()?;
    let lower = s.to_ascii_lowercase();
    let trimmed = lower.trim();

    let (skill_part, target_char) = if let Some(arrow_idx) = trimmed.find("->") {
        let left = trimmed[..arrow_idx].trim();
        let right = trimmed[arrow_idx + 2..].trim();
        let right = right
            .strip_prefix("char")
            .or_else(|| right.strip_prefix("ally"))
            .or_else(|| right.strip_prefix('c'))
            .unwrap_or(right)
            .trim();
        let tgt = right.parse::<i32>().ok()?;
        if !(1..=6).contains(&tgt) {
            return None;
        }
        (left, Some(tgt))
    } else if let Some(tgt_idx) = trimmed.find(" target ").or_else(|| trimmed.find(" ally ")) {
        let left = trimmed[..tgt_idx].trim();
        let rest = trimmed[tgt_idx + 1..].trim();
        let after_kw = rest
            .strip_prefix("target")
            .or_else(|| rest.strip_prefix("ally"))?
            .trim();
        let after_kw = after_kw
            .strip_prefix("char")
            .or_else(|| after_kw.strip_prefix("ally"))
            .or_else(|| after_kw.strip_prefix('c'))
            .unwrap_or(after_kw)
            .trim();
        let tgt = after_kw.parse::<i32>().ok()?;
        if !(1..=6).contains(&tgt) {
            return None;
        }
        (left, Some(tgt))
    } else {
        (trimmed, None)
    };

    // Now parse `skill_part` as:
    // Pattern A: `c1s2`, `char 1 skill 2`, `character 1 s 2`
    // Pattern B: `skill 1-2`, `skill 1.2`, `skill 1 2`
    // Pattern C: `1-2`, `1.2`
    let mut char_num: Option<i32> = None;
    let mut skill_num: Option<i32> = None;

    if let Some(rest) = skill_part
        .strip_prefix("character")
        .or_else(|| skill_part.strip_prefix("char"))
        .or_else(|| skill_part.strip_prefix('c'))
    {
        let rest = rest.trim_start();
        if let Some(&first_byte) = rest.as_bytes().first() {
            if (b'1'..=b'4').contains(&first_byte) {
                let c = (first_byte - b'0') as i32;
                let after_c = rest[1..].trim_start();
                if let Some(after_s) = after_c
                    .strip_prefix("skill")
                    .or_else(|| after_c.strip_prefix("sk"))
                    .or_else(|| after_c.strip_prefix('s'))
                {
                    let after_s = after_s.trim();
                    if after_s.len() == 1 {
                        let sb = after_s.as_bytes()[0];
                        if (b'1'..=b'4').contains(&sb) {
                            char_num = Some(c);
                            skill_num = Some((sb - b'0') as i32);
                        }
                    }
                }
            }
        }
    } else if let Some(rest) = skill_part.strip_prefix("skill") {
        let rest = rest.trim();
        if rest.len() >= 3 {
            let bytes = rest.as_bytes();
            if (b'1'..=b'4').contains(&bytes[0]) {
                let sep = bytes[1];
                if sep == b'-' || sep == b'.' || sep == b' ' {
                    let s_part = rest[2..].trim();
                    if s_part.len() == 1 && (b'1'..=b'4').contains(&s_part.as_bytes()[0]) {
                        char_num = Some((bytes[0] - b'0') as i32);
                        skill_num = Some((s_part.as_bytes()[0] - b'0') as i32);
                    }
                }
            }
        }
    } else if skill_part.len() == 3 {
        let bytes = skill_part.as_bytes();
        if (b'1'..=b'4').contains(&bytes[0])
            && (bytes[1] == b'-' || bytes[1] == b'.')
            && (b'1'..=b'4').contains(&bytes[2])
        {
            char_num = Some((bytes[0] - b'0') as i32);
            skill_num = Some((bytes[2] - b'0') as i32);
        }
    }

    let (c, sk) = (char_num?, skill_num?);
    let ensure_flag = if has_ensure { 1 } else { 0 };
    if let Some(tgt) = target_char {
        Some(DslFastToken {
            opcode: 2,
            arg1: c,
            arg2: sk,
            arg3: tgt,
            arg4: ensure_flag,
        })
    } else {
        Some(DslFastToken {
            opcode: 1,
            arg1: c,
            arg2: sk,
            arg3: ensure_flag,
            arg4: 0,
        })
    }
}

/// Classifies and tokenizes a single DSL line in a single pass.
pub fn parse_dsl_line(raw_line: &[u8]) -> DslFastToken {
    let trimmed_raw = trim_ascii(raw_line);
    if trimmed_raw.is_empty() || trimmed_raw.starts_with(b"#") || trimmed_raw.starts_with(b"//") {
        return DslFastToken::skip();
    }

    // Metadata directives (`@raid:`, `turn 1:`, `end`) or conditional (`if `) -> fallback
    if trimmed_raw.starts_with(b"@") {
        return DslFastToken::fallback();
    }

    // Check commands where `#` or `//` might be part of URL/selector (`navigate`, `goto`, `click`, `eval`, `wait_network`, `wait_element`)
    let first_word_end = trimmed_raw
        .iter()
        .position(|b| b.is_ascii_whitespace() || *b == b':')
        .unwrap_or(trimmed_raw.len());
    let first_word = &trimmed_raw[..first_word_end];

    if first_word.eq_ignore_ascii_case(b"if")
        || first_word.eq_ignore_ascii_case(b"turn")
        || first_word.eq_ignore_ascii_case(b"t")
        || first_word.eq_ignore_ascii_case(b"end")
        || first_word.eq_ignore_ascii_case(b"endif")
        || first_word.eq_ignore_ascii_case(b"end_turn")
        || first_word.eq_ignore_ascii_case(b"navigate")
        || first_word.eq_ignore_ascii_case(b"goto")
        || first_word.eq_ignore_ascii_case(b"click")
        || first_word.eq_ignore_ascii_case(b"eval")
        || first_word.eq_ignore_ascii_case(b"js")
        || first_word.eq_ignore_ascii_case(b"wait_network")
        || first_word.eq_ignore_ascii_case(b"wait_net")
        || first_word.eq_ignore_ascii_case(b"wait_element")
        || first_word.eq_ignore_ascii_case(b"wait_el")
    {
        return DslFastToken::fallback();
    }

    let (clean, has_ensure) = strip_inline_comment(trimmed_raw);
    if clean.is_empty() {
        return DslFastToken::skip();
    }

    // 1. Attack
    if clean.eq_ignore_ascii_case(b"attack")
        || clean.eq_ignore_ascii_case(b"atk")
        || clean.eq_ignore_ascii_case(b"normal attack")
    {
        return DslFastToken { opcode: 3, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }

    // 2. Quick Summon
    if clean.eq_ignore_ascii_case(b"qsum")
        || clean.eq_ignore_ascii_case(b"quicksummon")
        || clean.eq_ignore_ascii_case(b"quick_summon")
        || clean.eq_ignore_ascii_case(b"quick summon")
    {
        return DslFastToken { opcode: 4, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }

    // 3. Auto / Full Auto / Semi Auto / Smart Full Auto
    if clean.eq_ignore_ascii_case(b"smart_fa")
        || clean.eq_ignore_ascii_case(b"smart_full_auto")
        || clean.eq_ignore_ascii_case(b"smart full auto")
        || clean.eq_ignore_ascii_case(b"smart auto")
    {
        return DslFastToken { opcode: 12, arg1: 3, arg2: 0, arg3: 0, arg4: 0 };
    }
    if clean.eq_ignore_ascii_case(b"fa")
        || clean.eq_ignore_ascii_case(b"full_auto")
        || clean.eq_ignore_ascii_case(b"full auto")
        || clean.eq_ignore_ascii_case(b"fullauto")
    {
        return DslFastToken { opcode: 12, arg1: 1, arg2: 0, arg3: 0, arg4: 0 };
    }
    if clean.eq_ignore_ascii_case(b"semi_auto")
        || clean.eq_ignore_ascii_case(b"semi auto")
        || clean.eq_ignore_ascii_case(b"semiauto")
    {
        return DslFastToken { opcode: 12, arg1: 2, arg2: 0, arg3: 0, arg4: 0 };
    }
    if clean.eq_ignore_ascii_case(b"auto") {
        return DslFastToken { opcode: 12, arg1: 4, arg2: 0, arg3: 0, arg4: 0 };
    }

    // 4. Backup Request
    if clean.eq_ignore_ascii_case(b"backup")
        || clean.eq_ignore_ascii_case(b"backup_request")
        || clean.eq_ignore_ascii_case(b"request_backup")
        || clean.eq_ignore_ascii_case(b"request backup")
    {
        return DslFastToken { opcode: 13, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }

    // 5. Back Button
    if clean.eq_ignore_ascii_case(b"back")
        || clean.eq_ignore_ascii_case(b"go_back")
        || clean.eq_ignore_ascii_case(b"browser_back")
    {
        return DslFastToken { opcode: 14, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }

    // 6. Wait for loading / interactable
    if clean.eq_ignore_ascii_case(b"wait_for_loading")
        || clean.eq_ignore_ascii_case(b"wait_loading")
        || clean.eq_ignore_ascii_case(b"wait_interactable")
        || clean.eq_ignore_ascii_case(b"wait for loading")
        || clean.eq_ignore_ascii_case(b"wait loading")
        || clean.eq_ignore_ascii_case(b"wait interactable")
    {
        return DslFastToken { opcode: 10, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }

    // 7. Try skill or target_skill (`c1s1`, `1-2`, `c1s2 -> 3`, etc.)
    if let Some(skill_tok) = try_parse_skill(clean, has_ensure) {
        return skill_tok;
    }

    // Split into command and rest for parameterized commands
    let cmd_end = clean
        .iter()
        .position(|b| b.is_ascii_whitespace())
        .unwrap_or(clean.len());
    let cmd = &clean[..cmd_end];
    let rest = trim_ascii(&clean[cmd_end..]);

    // 8. Summon (numeric slot 1..6 fast path; named summon falls back)
    if cmd.eq_ignore_ascii_case(b"summon")
        || cmd.eq_ignore_ascii_case(b"sum")
        || cmd.eq_ignore_ascii_case(b"call")
    {
        let slot_bytes = if rest.len() >= 4 && rest[..4].eq_ignore_ascii_case(b"slot") {
            trim_ascii(&rest[4..])
        } else {
            rest
        };
        if let Some(slot) = parse_u32_ascii(slot_bytes) {
            if (1..=6).contains(&slot) {
                return DslFastToken {
                    opcode: 5,
                    arg1: slot as i32,
                    arg2: 0,
                    arg3: 0,
                    arg4: 0,
                };
            }
        }
        return DslFastToken::fallback();
    }

    // 9. Ougi / CA toggle
    if cmd.eq_ignore_ascii_case(b"ougi") || cmd.eq_ignore_ascii_case(b"ca") {
        if rest.eq_ignore_ascii_case(b"on")
            || rest.eq_ignore_ascii_case(b"auto")
            || rest.eq_ignore_ascii_case(b"enable")
        {
            return DslFastToken { opcode: 6, arg1: 1, arg2: 0, arg3: 0, arg4: 0 };
        }
        if rest.eq_ignore_ascii_case(b"off")
            || rest.eq_ignore_ascii_case(b"hold")
            || rest.eq_ignore_ascii_case(b"disable")
        {
            return DslFastToken { opcode: 6, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
        }
    }

    // 10. Wait ms (`wait 1500` or `sleep 500ms`)
    if cmd.eq_ignore_ascii_case(b"wait")
        || cmd.eq_ignore_ascii_case(b"sleep")
        || cmd.eq_ignore_ascii_case(b"delay")
    {
        let num_bytes = if rest.len() > 2 && rest[rest.len() - 2..].eq_ignore_ascii_case(b"ms") {
            trim_ascii(&rest[..rest.len() - 2])
        } else {
            rest
        };
        if let Some(ms) = parse_u32_ascii(num_bytes) {
            return DslFastToken {
                opcode: 7,
                arg1: ms as i32,
                arg2: 0,
                arg3: 0,
                arg4: 0,
            };
        }
    }

    // 11. Wait turn (`wait_turn 3`)
    if cmd.eq_ignore_ascii_case(b"wait_turn") {
        if let Some(turn) = parse_u32_ascii(rest) {
            return DslFastToken {
                opcode: 8,
                arg1: turn as i32,
                arg2: 0,
                arg3: 0,
                arg4: 0,
            };
        }
    }

    // 12. Wait wave (`wait_wave 2` or `wait_wave`)
    if cmd.eq_ignore_ascii_case(b"wait_wave") || cmd.eq_ignore_ascii_case(b"wait_for_wave") {
        if rest.is_empty() {
            return DslFastToken { opcode: 9, arg1: 2, arg2: 0, arg3: 0, arg4: 0 };
        }
        if let Some(wave) = parse_u32_ascii(rest) {
            return DslFastToken {
                opcode: 9,
                arg1: wave as i32,
                arg2: 0,
                arg3: 0,
                arg4: 0,
            };
        }
    }

    // 13. Wait random (`wait_random 500 1500` or `wait_random`)
    if cmd.eq_ignore_ascii_case(b"wait_random") || cmd.eq_ignore_ascii_case(b"random_delay") {
        if rest.is_empty() {
            return DslFastToken { opcode: 11, arg1: 500, arg2: 1500, arg3: 0, arg4: 0 };
        }
        if let Some(sep_idx) = rest.iter().position(|b| b.is_ascii_whitespace() || *b == b'-') {
            let min_b = trim_ascii(&rest[..sep_idx]);
            let max_b = trim_ascii(&rest[sep_idx + 1..]);
            if let (Some(min_ms), Some(max_ms)) = (parse_u32_ascii(min_b), parse_u32_ascii(max_b)) {
                return DslFastToken {
                    opcode: 11,
                    arg1: min_ms as i32,
                    arg2: max_ms as i32,
                    arg3: 0,
                    arg4: 0,
                };
            }
        }
    }

    // 14. Target enemy (`target_enemy 2` or `select_enemy 1`)
    if cmd.eq_ignore_ascii_case(b"target_enemy") || cmd.eq_ignore_ascii_case(b"select_enemy") {
        if let Some(idx) = parse_u32_ascii(rest) {
            if (1..=3).contains(&idx) {
                return DslFastToken {
                    opcode: 15,
                    arg1: idx as i32,
                    arg2: 0,
                    arg3: 0,
                    arg4: 0,
                };
            }
        }
    }

    // 15. Heal / Potion (`heal green`, `potion blue`, `use elixir`)
    if cmd.eq_ignore_ascii_case(b"heal")
        || cmd.eq_ignore_ascii_case(b"potion")
        || cmd.eq_ignore_ascii_case(b"use")
    {
        let p_bytes = if rest.len() > 6 && rest[rest.len() - 6..].eq_ignore_ascii_case(b"potion") {
            trim_ascii(&rest[..rest.len() - 6])
        } else {
            rest
        };
        if p_bytes.eq_ignore_ascii_case(b"green") {
            return DslFastToken { opcode: 16, arg1: 1, arg2: 0, arg3: 0, arg4: 0 };
        }
        if p_bytes.eq_ignore_ascii_case(b"blue") {
            return DslFastToken { opcode: 16, arg1: 2, arg2: 0, arg3: 0, arg4: 0 };
        }
        if p_bytes.eq_ignore_ascii_case(b"elixir") {
            return DslFastToken { opcode: 16, arg1: 3, arg2: 0, arg3: 0, arg4: 0 };
        }
    }

    // 16. Guard (`guard all`, `guard on`, `guard off`, `guard 1`)
    if cmd.eq_ignore_ascii_case(b"guard") {
        if rest.eq_ignore_ascii_case(b"all") {
            return DslFastToken { opcode: 17, arg1: 5, arg2: 0, arg3: 0, arg4: 0 };
        }
        if rest.eq_ignore_ascii_case(b"on") {
            return DslFastToken { opcode: 17, arg1: 6, arg2: 0, arg3: 0, arg4: 0 };
        }
        if rest.eq_ignore_ascii_case(b"off") {
            return DslFastToken { opcode: 17, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
        }
        if rest.len() == 1 && (b'1'..=b'4').contains(&rest[0]) {
            return DslFastToken {
                opcode: 17,
                arg1: (rest[0] - b'0') as i32,
                arg2: 0,
                arg3: 0,
                arg4: 0,
            };
        }
    }

    // 17. Exit if score (`exit_if_score 1500000`)
    if cmd.eq_ignore_ascii_case(b"exit_if_score") {
        if let Some(score) = parse_score_ascii(rest) {
            return DslFastToken {
                opcode: 18,
                arg1: score,
                arg2: 0,
                arg3: 0,
                arg4: 0,
            };
        }
    }

    // 18. Touch tap (`touch_tap 120 340` or `tap 120, 340`)
    if cmd.eq_ignore_ascii_case(b"touch_tap") || cmd.eq_ignore_ascii_case(b"tap") {
        if let Some(sep_idx) = rest.iter().position(|b| b.is_ascii_whitespace() || *b == b',') {
            let x_b = trim_ascii(&rest[..sep_idx]);
            let y_b = trim_ascii(
                rest[sep_idx + 1..]
                    .strip_prefix(b",")
                    .unwrap_or(&rest[sep_idx + 1..]),
            );
            if let (Some(x), Some(y)) = (parse_u32_ascii(x_b), parse_u32_ascii(y_b)) {
                return DslFastToken {
                    opcode: 19,
                    arg1: x as i32,
                    arg2: y as i32,
                    arg3: 0,
                    arg4: 0,
                };
            }
        }
    }

    DslFastToken::fallback()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_dsl_line_skills_and_comments() {
        assert_eq!(parse_dsl_line(b"  # pure comment"), DslFastToken::skip());
        assert_eq!(parse_dsl_line(b"c1s3"), DslFastToken { opcode: 1, arg1: 1, arg2: 3, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"c2s1 # ensure"), DslFastToken { opcode: 1, arg1: 2, arg2: 1, arg3: 1, arg4: 0 });
        assert_eq!(parse_dsl_line(b"skill 4-2 // ensure cast"), DslFastToken { opcode: 1, arg1: 4, arg2: 2, arg3: 1, arg4: 0 });
        assert_eq!(parse_dsl_line(b"c1s2 -> 3 # ensure"), DslFastToken { opcode: 2, arg1: 1, arg2: 2, arg3: 3, arg4: 1 });
        assert_eq!(parse_dsl_line(b"skill 2-1 target 4"), DslFastToken { opcode: 2, arg1: 2, arg2: 1, arg3: 4, arg4: 0 });
    }

    #[test]
    fn test_parse_dsl_line_combat_commands() {
        assert_eq!(parse_dsl_line(b"attack"), DslFastToken { opcode: 3, arg1: 0, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"qsum"), DslFastToken { opcode: 4, arg1: 0, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"summon 1"), DslFastToken { opcode: 5, arg1: 1, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"summon bubs"), DslFastToken::fallback());
        assert_eq!(parse_dsl_line(b"ougi off"), DslFastToken { opcode: 6, arg1: 0, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"wait 1500ms"), DslFastToken { opcode: 7, arg1: 1500, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"fa"), DslFastToken { opcode: 12, arg1: 1, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"smart_fa"), DslFastToken { opcode: 12, arg1: 3, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"guard all"), DslFastToken { opcode: 17, arg1: 5, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"exit_if_score 1,500,000"), DslFastToken { opcode: 18, arg1: 1500000, arg2: 0, arg3: 0, arg4: 0 });
    }
}
