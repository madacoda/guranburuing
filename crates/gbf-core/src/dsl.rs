/// Fast single-pass zero-regex DSL line classifier and action tokenizer.
///
/// Replaces up to 40 sequential regular expression evaluations per line in
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

/// Checks if a comment slice contains ensure keywords (`ensure`, `make sure`, `required`, `clicked or casted`).
#[inline]
fn is_ensure_comment(comment: &[u8]) -> bool {
    let Ok(s) = core::str::from_utf8(comment) else {
        return false;
    };
    let lower = s.to_ascii_lowercase();
    lower.contains("ensure")
        || lower.contains("make sure")
        || lower.contains("makersure")
        || lower.contains("required")
        || lower.contains("require")
        || lower.contains("clicked or casted")
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
fn strip_inline_comment(line: &[u8]) -> (&[u8], bool) {
    let trimmed = trim_ascii(line);
    if trimmed.is_empty() {
        return (&[], false);
    }
    if trimmed.starts_with(b"#") || trimmed.starts_with(b"//") || trimmed.starts_with(b";") {
        return (&[], false);
    }

    let mut comment_start: Option<(usize, usize)> = None;
    let len = trimmed.len();
    let mut i = 0;
    while i < len {
        if trimmed[i] == b'#' && !(i + 1 < len && trimmed[i + 1].is_ascii_digit()) {
            comment_start = Some((i, i + 1));
            break;
        }
        if i + 1 < len && trimmed[i] == b'/' && trimmed[i + 1] == b'/' {
            comment_start = Some((i, i + 2));
            break;
        }
        i += 1;
    }

    let (mut code, mut has_ensure) = if let Some((code_end, c_start)) = comment_start {
        let code = trim_ascii(&trimmed[..code_end]);
        let comment = &trimmed[c_start..];
        (code, is_ensure_comment(comment))
    } else {
        (trimmed, false)
    };

    // Also strip trailing parenthetical comment like `c1s2 (ensure)`
    if code.ends_with(b")") {
        if let Some(open_idx) = code.iter().rposition(|&b| b == b'(') {
            let paren_body = &code[open_idx + 1..code.len() - 1];
            if is_ensure_comment(paren_body) {
                has_ensure = true;
            }
            code = trim_ascii(&code[..open_idx]);
        }
    }

    (code, has_ensure)
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
/// and optional target `-> 3`, `target 3`, `ally 3`, `on 2`.
fn try_parse_skill(clean: &[u8], has_ensure: bool) -> Option<DslFastToken> {
    let s = std::str::from_utf8(clean).ok()?;
    let lower = s.to_ascii_lowercase();
    let trimmed = lower.trim();

    let parse_target_suffix = |raw_tgt: &str| -> Option<i32> {
        let right = raw_tgt
            .trim()
            .strip_prefix("character")
            .or_else(|| raw_tgt.trim().strip_prefix("char"))
            .or_else(|| raw_tgt.trim().strip_prefix("ally"))
            .or_else(|| raw_tgt.trim().strip_prefix('c'))
            .unwrap_or(raw_tgt.trim())
            .trim();
        let tgt = right.parse::<i32>().ok()?;
        if (1..=6).contains(&tgt) {
            Some(tgt)
        } else {
            None
        }
    };

    let (skill_part, target_char) = if let Some(arrow_idx) = trimmed.find("->") {
        let left = trimmed[..arrow_idx].trim();
        let tgt = parse_target_suffix(&trimmed[arrow_idx + 2..])?;
        (left, Some(tgt))
    } else if let Some(tgt_idx) = trimmed
        .find(" target ")
        .or_else(|| trimmed.find(" ally "))
        .or_else(|| trimmed.find(" on "))
        .or_else(|| trimmed.find(" to "))
    {
        let left = trimmed[..tgt_idx].trim();
        let rest = trimmed[tgt_idx + 1..].trim();
        let after_kw = rest
            .strip_prefix("targeted on")
            .or_else(|| rest.strip_prefix("target"))
            .or_else(|| rest.strip_prefix("ally"))
            .or_else(|| rest.strip_prefix("on"))
            .or_else(|| rest.strip_prefix("to"))?
            .trim();
        let tgt = parse_target_suffix(after_kw)?;
        (left, Some(tgt))
    } else {
        (trimmed, None)
    };

    let mut char_num: Option<i32> = None;
    let mut skill_num: Option<i32> = None;

    if let Some(rest) = skill_part
        .strip_prefix("character")
        .or_else(|| skill_part.strip_prefix("char"))
        .or_else(|| skill_part.strip_prefix('c'))
    {
        let rest = rest.trim_start_matches(|c: char| c.is_ascii_whitespace() || c == '_');
        if let Some(&first_byte) = rest.as_bytes().first() {
            if (b'1'..=b'4').contains(&first_byte) {
                let c = (first_byte - b'0') as i32;
                let after_c =
                    rest[1..].trim_start_matches(|ch: char| ch.is_ascii_whitespace() || ch == '-' || ch == '_');
                if let Some(after_s) = after_c
                    .strip_prefix("skill")
                    .or_else(|| after_c.strip_prefix("sk"))
                    .or_else(|| after_c.strip_prefix('s'))
                {
                    let after_s = after_s.trim_start_matches(|ch: char| ch.is_ascii_whitespace() || ch == '_');
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
        let rest = rest.trim_start_matches(|c: char| c.is_ascii_whitespace() || c == '_');
        if rest.len() >= 3 {
            let bytes = rest.as_bytes();
            if (b'1'..=b'4').contains(&bytes[0]) {
                let sep = bytes[1];
                if sep == b'-' || sep == b'.' || sep == b' ' || sep == b'_' {
                    let s_part = rest[2..]
                        .trim_start_matches(|c: char| c.is_ascii_whitespace() || c == '-' || c == '_')
                        .trim_start_matches("skill")
                        .trim_start_matches('s')
                        .trim();
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
    if trimmed_raw.is_empty()
        || trimmed_raw.starts_with(b"#")
        || trimmed_raw.starts_with(b"//")
        || trimmed_raw.starts_with(b";")
    {
        return DslFastToken::skip();
    }

    if trimmed_raw.starts_with(b"@") {
        return DslFastToken::fallback();
    }

    // Check commands where `#` or `//` might be part of URL/selector (`navigate`, `goto`, `click`, `eval`, `wait_network`, `wait_element`, `do_until_finish`, `run_daily`)
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
        || first_word.eq_ignore_ascii_case(b"eval")
        || first_word.eq_ignore_ascii_case(b"js")
        || first_word.eq_ignore_ascii_case(b"wait_network")
        || first_word.eq_ignore_ascii_case(b"wait_net")
        || first_word.eq_ignore_ascii_case(b"wait_element")
        || first_word.eq_ignore_ascii_case(b"wait_el")
        || first_word.eq_ignore_ascii_case(b"do_until_finish")
        || first_word.eq_ignore_ascii_case(b"loop_until_finish")
        || first_word.eq_ignore_ascii_case(b"until_finish")
        || first_word.eq_ignore_ascii_case(b"run_daily_target")
        || first_word.eq_ignore_ascii_case(b"run_daily")
        || first_word.eq_ignore_ascii_case(b"daily_target")
    {
        return DslFastToken::fallback();
    }

    if first_word.eq_ignore_ascii_case(b"click") {
        let after_click = trim_ascii(&trimmed_raw[first_word_end..]);
        if after_click.eq_ignore_ascii_case(b"back")
            || after_click.eq_ignore_ascii_case(b"back button")
            || after_click.eq_ignore_ascii_case(b"back_button")
        {
            return DslFastToken { opcode: 14, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
        }
        return DslFastToken::fallback();
    }

    let (clean, has_ensure) = strip_inline_comment(trimmed_raw);
    if clean.is_empty() {
        return DslFastToken::skip();
    }

    // 1. Reload / F5 / Refresh (Opcode 20)
    if clean.eq_ignore_ascii_case(b"f5")
        || clean.eq_ignore_ascii_case(b"reload")
        || clean.eq_ignore_ascii_case(b"refresh")
    {
        return DslFastToken { opcode: 20, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }

    // 2. Tap Ready / Ready (Opcode 21)
    if clean.eq_ignore_ascii_case(b"ready")
        || clean.eq_ignore_ascii_case(b"ready: click")
        || clean.eq_ignore_ascii_case(b"tap ready")
        || clean.eq_ignore_ascii_case(b"tap_ready")
        || clean.eq_ignore_ascii_case(b"tap the ready")
        || clean.eq_ignore_ascii_case(b"tab ready")
        || clean.eq_ignore_ascii_case(b"tab the ready")
    {
        return DslFastToken { opcode: 21, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }

    // 3. Confirm Result / Loot (Opcode 22)
    if clean.eq_ignore_ascii_case(b"confirm")
        || clean.eq_ignore_ascii_case(b"confirm_result")
        || clean.eq_ignore_ascii_case(b"loot")
        || clean.eq_ignore_ascii_case(b"result")
        || clean.eq_ignore_ascii_case(b"done")
        || clean.eq_ignore_ascii_case(b"finish")
        || clean.eq_ignore_ascii_case(b"rerun")
        || clean.eq_ignore_ascii_case(b"next")
    {
        return DslFastToken { opcode: 22, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }

    // 4. Log Enemy HP (Opcode 23)
    if clean.eq_ignore_ascii_case(b"log_enemy_hp")
        || clean.eq_ignore_ascii_case(b"log enemy hp")
        || clean.eq_ignore_ascii_case(b"log hp")
        || clean.eq_ignore_ascii_case(b"check hp")
        || clean.eq_ignore_ascii_case(b"check enemy hp")
        || clean.eq_ignore_ascii_case(b"print hp")
        || clean.eq_ignore_ascii_case(b"enemy hp")
        || clean.eq_ignore_ascii_case(b"enemy_hp")
    {
        return DslFastToken { opcode: 23, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }

    // 5. Exit if Dead (Opcode 24)
    if clean.eq_ignore_ascii_case(b"exit_if_dead")
        || clean.eq_ignore_ascii_case(b"exit if dead")
        || clean.eq_ignore_ascii_case(b"finish if dead")
        || clean.eq_ignore_ascii_case(b"stop if dead")
    {
        return DslFastToken { opcode: 24, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }

    // 6. Pro Skip Favorites / Fate / Story / Dismiss Macros (Opcodes 26..29)
    if clean.eq_ignore_ascii_case(b"pro_skip_favorites")
        || clean.eq_ignore_ascii_case(b"pro skip favorites")
        || clean.eq_ignore_ascii_case(b"pro_skip")
        || clean.eq_ignore_ascii_case(b"pro skip")
        || clean.eq_ignore_ascii_case(b"daily_favorites")
        || clean.eq_ignore_ascii_case(b"daily favorites")
        || clean.eq_ignore_ascii_case(b"daily_pro")
        || clean.eq_ignore_ascii_case(b"daily pro")
    {
        return DslFastToken { opcode: 26, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }
    if clean.eq_ignore_ascii_case(b"auto_fate_episode")
        || clean.eq_ignore_ascii_case(b"auto fate episode")
        || clean.eq_ignore_ascii_case(b"auto_fate")
        || clean.eq_ignore_ascii_case(b"auto fate")
        || clean.eq_ignore_ascii_case(b"fate_stories")
        || clean.eq_ignore_ascii_case(b"fate stories")
        || clean.eq_ignore_ascii_case(b"fate_episode")
        || clean.eq_ignore_ascii_case(b"fate episode")
        || clean.eq_ignore_ascii_case(b"fate_auto")
        || clean.eq_ignore_ascii_case(b"fate auto")
    {
        return DslFastToken { opcode: 27, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }
    if clean.eq_ignore_ascii_case(b"skip_story_scene")
        || clean.eq_ignore_ascii_case(b"skip story scene")
        || clean.eq_ignore_ascii_case(b"skip_story")
        || clean.eq_ignore_ascii_case(b"skip story")
        || clean.eq_ignore_ascii_case(b"skip_scene")
        || clean.eq_ignore_ascii_case(b"skip scene")
    {
        return DslFastToken { opcode: 28, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }
    if clean.eq_ignore_ascii_case(b"dismiss_popups")
        || clean.eq_ignore_ascii_case(b"dismiss popups")
        || clean.eq_ignore_ascii_case(b"dismiss_popup")
        || clean.eq_ignore_ascii_case(b"dismiss popup")
        || clean.eq_ignore_ascii_case(b"dismiss_modals")
        || clean.eq_ignore_ascii_case(b"dismiss modals")
        || clean.eq_ignore_ascii_case(b"dismiss_all")
        || clean.eq_ignore_ascii_case(b"dismiss all")
    {
        return DslFastToken { opcode: 29, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }

    // 7. Attack (Opcode 3)
    if clean.eq_ignore_ascii_case(b"attack")
        || clean.eq_ignore_ascii_case(b"atk")
        || clean.eq_ignore_ascii_case(b"normal attack")
        || clean.eq_ignore_ascii_case(b"attack again")
    {
        return DslFastToken { opcode: 3, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }

    // 8. Quick Summon / Quick Call (Opcode 4)
    if clean.eq_ignore_ascii_case(b"qsum")
        || clean.eq_ignore_ascii_case(b"qs")
        || clean.eq_ignore_ascii_case(b"quicksummon")
        || clean.eq_ignore_ascii_case(b"quick_summon")
        || clean.eq_ignore_ascii_case(b"quick summon")
        || clean.eq_ignore_ascii_case(b"quick_call")
        || clean.eq_ignore_ascii_case(b"quick call")
    {
        return DslFastToken { opcode: 4, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }

    // 9. Auto / Full Auto / Semi Auto / Smart Full Auto (Opcode 12)
    if clean.eq_ignore_ascii_case(b"smart_fa")
        || clean.eq_ignore_ascii_case(b"smart_full_auto")
        || clean.eq_ignore_ascii_case(b"smart full auto")
        || clean.eq_ignore_ascii_case(b"smart auto")
        || clean.eq_ignore_ascii_case(b"smart_auto")
        || clean.eq_ignore_ascii_case(b"fast_full_auto")
        || clean.eq_ignore_ascii_case(b"fast_auto")
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

    // 10. Backup Request (Opcode 13)
    if clean.eq_ignore_ascii_case(b"backup")
        || clean.eq_ignore_ascii_case(b"backup_request")
        || clean.eq_ignore_ascii_case(b"request_backup")
        || clean.eq_ignore_ascii_case(b"request backup")
    {
        return DslFastToken { opcode: 13, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }

    // 11. Back Button (Opcode 14)
    if clean.eq_ignore_ascii_case(b"back")
        || clean.eq_ignore_ascii_case(b"back button")
        || clean.eq_ignore_ascii_case(b"back_button")
        || clean.eq_ignore_ascii_case(b"go_back")
        || clean.eq_ignore_ascii_case(b"browser_back")
    {
        return DslFastToken { opcode: 14, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }

    // 12. Wait for loading / interactable (Opcode 10)
    if clean.eq_ignore_ascii_case(b"wait_for_loading")
        || clean.eq_ignore_ascii_case(b"wait_loading")
        || clean.eq_ignore_ascii_case(b"wait_interactable")
        || clean.eq_ignore_ascii_case(b"wait for loading")
        || clean.eq_ignore_ascii_case(b"wait loading")
        || clean.eq_ignore_ascii_case(b"wait interactable")
        || clean.eq_ignore_ascii_case(b"make sure all interactable")
        || clean.eq_ignore_ascii_case(b"make sure interactable")
    {
        return DslFastToken { opcode: 10, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }

    // 13. Try skill or target_skill (`c1s1`, `1-2`, `c1s2 -> 3`, `c4s2 on 2`, etc.)
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

    // 13b. Attack with delay (`attack 350`, `attack wait 350ms`)
    if cmd.eq_ignore_ascii_case(b"attack") || cmd.eq_ignore_ascii_case(b"atk") {
        let delay_part = if rest.len() >= 4 && rest[..4].eq_ignore_ascii_case(b"wait") {
            trim_ascii(&rest[4..])
        } else {
            rest
        };
        let num_bytes = if delay_part.len() > 2
            && delay_part[delay_part.len() - 2..].eq_ignore_ascii_case(b"ms")
        {
            trim_ascii(&delay_part[..delay_part.len() - 2])
        } else {
            delay_part
        };
        if let Some(ms) = parse_u32_ascii(num_bytes) {
            return DslFastToken {
                opcode: 3,
                arg1: ms as i32,
                arg2: 0,
                arg3: 0,
                arg4: 0,
            };
        }
    }

    // 14. Summon (numeric slot 1..6 fast path; named summon falls back)
    if cmd.eq_ignore_ascii_case(b"summon")
        || cmd.eq_ignore_ascii_case(b"sum")
        || cmd.eq_ignore_ascii_case(b"call")
    {
        let mut slot_bytes = rest;
        for kw in [b"number".as_slice(), b"slot".as_slice(), b"no.".as_slice(), b"no".as_slice()] {
            if slot_bytes.len() >= kw.len() && slot_bytes[..kw.len()].eq_ignore_ascii_case(kw) {
                slot_bytes = trim_ascii(&slot_bytes[kw.len()..]);
                break;
            }
        }
        if slot_bytes.starts_with(b"#") {
            slot_bytes = trim_ascii(&slot_bytes[1..]);
        }
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

    // 15. Ougi / CA toggle
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

    // 16. Wait ms (`wait 1500` or `sleep 500ms`)
    if cmd.eq_ignore_ascii_case(b"wait")
        || cmd.eq_ignore_ascii_case(b"sleep")
        || cmd.eq_ignore_ascii_case(b"delay")
    {
        if rest.len() >= 4 && rest[..4].eq_ignore_ascii_case(b"turn") {
            let t_bytes = trim_ascii(&rest[4..]);
            if let Some(turn) = parse_u32_ascii(t_bytes) {
                return DslFastToken {
                    opcode: 8,
                    arg1: turn as i32,
                    arg2: 0,
                    arg3: 0,
                    arg4: 0,
                };
            }
        }
        if rest.len() >= 4 && rest[..4].eq_ignore_ascii_case(b"wave") {
            let w_bytes = trim_ascii(&rest[4..]);
            if w_bytes.is_empty() {
                return DslFastToken { opcode: 9, arg1: 2, arg2: 0, arg3: 0, arg4: 0 };
            }
            if let Some(wave) = parse_u32_ascii(w_bytes) {
                return DslFastToken {
                    opcode: 9,
                    arg1: wave as i32,
                    arg2: 0,
                    arg3: 0,
                    arg4: 0,
                };
            }
        }
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

    // 17. Wait turn (`wait_turn 3`)
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

    // 18. Wait wave (`wait_wave 2` or `wait_wave`)
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

    // 19. Wait random (`wait_random 500 1500` or `wait_random` or `wait_randomize`)
    if cmd.eq_ignore_ascii_case(b"wait_random")
        || cmd.eq_ignore_ascii_case(b"wait_randomize")
        || cmd.eq_ignore_ascii_case(b"random_delay")
        || cmd.eq_ignore_ascii_case(b"delay_random")
        || cmd.eq_ignore_ascii_case(b"random_wait")
    {
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

    // 20. Target enemy (`target_enemy 2` or `select_enemy 1`)
    if cmd.eq_ignore_ascii_case(b"target_enemy")
        || cmd.eq_ignore_ascii_case(b"select_enemy")
        || cmd.eq_ignore_ascii_case(b"target")
    {
        let idx_bytes = if rest.len() >= 5 && rest[..5].eq_ignore_ascii_case(b"enemy") {
            trim_ascii(&rest[5..])
        } else {
            rest
        };
        if let Some(idx) = parse_u32_ascii(idx_bytes) {
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

    // 21. Heal / Potion (`heal green`, `potion blue`, `use elixir`)
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

    // 22. Guard (`guard all`, `guard on`, `guard off`, `guard 1`)
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

    // 23. Exit if score (`exit_if_score 1500000` or `exit_on_score 1500000`)
    if cmd.eq_ignore_ascii_case(b"exit_if_score") || cmd.eq_ignore_ascii_case(b"exit_on_score") {
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

    // 24. Exit if HP (`exit_if_hp 50` or `exit_if_hp 25%`)
    if cmd.eq_ignore_ascii_case(b"exit_if_hp") {
        let num_b = rest.strip_suffix(b"%").unwrap_or(rest);
        if let Some(hp) = parse_u32_ascii(trim_ascii(num_b)) {
            return DslFastToken {
                opcode: 25,
                arg1: hp as i32,
                arg2: 0,
                arg3: 0,
                arg4: 0,
            };
        }
    }

    // 25. Touch tap (`touch_tap 120 340` or `tap 120, 340`)
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
        assert_eq!(parse_dsl_line(b"c3s4 (make sure)"), DslFastToken { opcode: 1, arg1: 3, arg2: 4, arg3: 1, arg4: 0 });
        assert_eq!(parse_dsl_line(b"skill 4-2 // ensure cast"), DslFastToken { opcode: 1, arg1: 4, arg2: 2, arg3: 1, arg4: 0 });
        assert_eq!(parse_dsl_line(b"c1s2 -> 3 # ensure"), DslFastToken { opcode: 2, arg1: 1, arg2: 2, arg3: 3, arg4: 1 });
        assert_eq!(parse_dsl_line(b"c4s2 on 2"), DslFastToken { opcode: 2, arg1: 4, arg2: 2, arg3: 2, arg4: 0 });
        assert_eq!(parse_dsl_line(b"skill 2-1 target 4"), DslFastToken { opcode: 2, arg1: 2, arg2: 1, arg3: 4, arg4: 0 });
    }

    #[test]
    fn test_parse_dsl_line_combat_commands() {
        assert_eq!(parse_dsl_line(b"attack"), DslFastToken { opcode: 3, arg1: 0, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"attack 350"), DslFastToken { opcode: 3, arg1: 350, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"attack wait 350ms"), DslFastToken { opcode: 3, arg1: 350, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"qsum"), DslFastToken { opcode: 4, arg1: 0, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"qs"), DslFastToken { opcode: 4, arg1: 0, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"quick call"), DslFastToken { opcode: 4, arg1: 0, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"summon 1"), DslFastToken { opcode: 5, arg1: 1, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"summon slot #6"), DslFastToken { opcode: 5, arg1: 6, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"summon bubs"), DslFastToken::fallback());
        assert_eq!(parse_dsl_line(b"ougi off"), DslFastToken { opcode: 6, arg1: 0, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"wait 1500ms"), DslFastToken { opcode: 7, arg1: 1500, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"fa"), DslFastToken { opcode: 12, arg1: 1, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"smart_fa"), DslFastToken { opcode: 12, arg1: 3, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"guard all"), DslFastToken { opcode: 17, arg1: 5, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"exit_if_score 1,500,000"), DslFastToken { opcode: 18, arg1: 1500000, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"f5"), DslFastToken { opcode: 20, arg1: 0, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"reload"), DslFastToken { opcode: 20, arg1: 0, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"tap ready"), DslFastToken { opcode: 21, arg1: 0, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"confirm"), DslFastToken { opcode: 22, arg1: 0, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"log_enemy_hp"), DslFastToken { opcode: 23, arg1: 0, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"exit_if_dead"), DslFastToken { opcode: 24, arg1: 0, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"exit_if_hp 25%"), DslFastToken { opcode: 25, arg1: 25, arg2: 0, arg3: 0, arg4: 0 });
        assert_eq!(parse_dsl_line(b"pro_skip_favorites"), DslFastToken { opcode: 26, arg1: 0, arg2: 0, arg3: 0, arg4: 0 });
    }
}
