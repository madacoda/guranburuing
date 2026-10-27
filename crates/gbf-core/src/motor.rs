// crates/gbf-core/src/motor.rs
use rand::rngs::SmallRng;
use rand::{Rng, SeedableRng};
use rand_distr::StandardNormal;
use std::cell::RefCell;

thread_local! {
    static THREAD_RNG: RefCell<SmallRng> = RefCell::new(SmallRng::from_entropy());
}

/// Samples a Gaussian normal distribution N(mean, std_dev^2) using the Ziggurat algorithm
/// over a thread-local Xoshiro256++ (`SmallRng`) generator.
#[inline]
pub fn sample_gaussian(mean: f64, std_dev: f64) -> f64 {
    THREAD_RNG.with(|rng_cell| {
        let mut rng = rng_cell.borrow_mut();
        let z: f64 = rng.sample(StandardNormal);
        mean + z * std_dev
    })
}

/// Samples a Log-Normal human reaction delay in milliseconds tuned to the active SpeedProfile.
/// `speed_profile`: 0 = stealth, 1 = fast, 2 = turbo
#[inline]
pub fn sample_log_normal_delay(
    median_ms: f64,
    shape: f64,
    speed_profile: u8,
    is_production: bool,
) -> u32 {
    THREAD_RNG.with(|rng_cell| {
        let mut rng = rng_cell.borrow_mut();

        let (effective_median, allow_hesitation) = if is_production {
            ((median_ms * 0.20).max(10.0), false)
        } else {
            match speed_profile {
                2 => ((median_ms * 0.25).max(15.0), false),
                1 => ((median_ms * 0.75).max(35.0), rng.gen::<f64>() < 0.03),
                _ => (median_ms.max(1.0), rng.gen::<f64>() < 0.05),
            }
        };

        let mu = effective_median.ln();
        let z0: f64 = rng.sample(StandardNormal);
        let mut duration = (mu + z0 * shape).exp();

        if allow_hesitation {
            let z_hes: f64 = rng.sample(StandardNormal);
            duration += (1400.0_f64.ln() + z_hes * 0.30).exp();
        }

        let min_delay = if is_production {
            8.0
        } else {
            match speed_profile {
                2 => 10.0,
                1 => 25.0,
                _ => 45.0,
            }
        };

        duration.max(min_delay).round() as u32
    })
}

/// Samples an organic inter-run delay between workflow runs in milliseconds.
/// `speed_profile`: 0 = stealth, 1 = fast, 2 = turbo
#[inline]
pub fn sample_inter_run_delay(speed_profile: u8, is_production: bool) -> u32 {
    THREAD_RNG.with(|rng_cell| {
        let mut rng = rng_cell.borrow_mut();

        let (mut baseline_median, shape, mut hesitation_chance, hesitation_median): (
            f64,
            f64,
            f64,
            f64,
        ) = match speed_profile {
            2 => (750.0, 0.20, 0.01, 500.0),
            0 => (3200.0, 0.30, 0.07, 2500.0),
            _ => (1600.0, 0.24, 0.035, 1400.0),
        };

        if is_production {
            baseline_median = (baseline_median * 0.25).max(250.0);
            hesitation_chance = 0.0;
        }

        let mu = baseline_median.ln();
        let z0: f64 = rng.sample(StandardNormal);
        let mut duration = (mu + z0 * shape).exp();

        if hesitation_chance > 0.0 && rng.gen::<f64>() < hesitation_chance {
            let z_hes: f64 = rng.sample(StandardNormal);
            duration += (hesitation_median.ln() + z_hes * 0.28).exp();
        }

        let (min_floor, max_ceil) = match speed_profile {
            2 => (400.0, 1400.0),
            1 => (950.0, 3800.0),
            _ => (1800.0, 8000.0),
        };

        duration.clamp(min_floor, max_ceil).round() as u32
    })
}

/// Evaluates a 2D cubic Bézier curve at parameter t in [0.0, 1.0].
#[inline]
pub fn evaluate_cubic_bezier(
    p0x: f64,
    p0y: f64,
    p1x: f64,
    p1y: f64,
    p2x: f64,
    p2y: f64,
    p3x: f64,
    p3y: f64,
    t: f64,
) -> (f64, f64) {
    let u = 1.0 - t;
    let tt = t * t;
    let uu = u * u;
    let uuu = uu * u;
    let ttt = tt * t;

    let x = uuu * p0x + 3.0 * uu * t * p1x + 3.0 * u * tt * p2x + ttt * p3x;
    let y = uuu * p0y + 3.0 * uu * t * p1y + 3.0 * u * tt * p2y + ttt * p3y;
    (x, y)
}

/// Samples a natural click coordinate within the inner portion of a bounding box using a 2D Gaussian.
#[inline]
pub fn sample_target_coordinate(bx: f64, by: f64, bw: f64, bh: f64) -> (f64, f64) {
    let sigma_x = bw / 5.5;
    let sigma_y = bh / 5.5;

    let raw_x = bx + bw * 0.5 + sample_gaussian(0.0, sigma_x);
    let raw_y = by + bh * 0.5 + sample_gaussian(0.0, sigma_y);

    // Match JS: Math.max(box.x + 3, Math.min(box.x + box.width - 3, rawX))
    let clamped_x = (bx + 3.0).max((bx + bw - 3.0).min(raw_x));
    let clamped_y = (by + 3.0).max((by + bh - 3.0).min(raw_y));
    (clamped_x, clamped_y)
}

/// Computes an entire Fitts's Law cubic Bézier cursor trajectory in one zero-allocation pass.
/// Writes `steps` triples of `[x, y, step_delay_ms]` into `out_buf` (which must have length >= 42).
/// Returns the number of steps generated (`0` if distance < 4.0 or turbo mode).
pub fn compute_bezier_trajectory(
    start_x: f64,
    start_y: f64,
    target_x: f64,
    target_y: f64,
    speed_profile: u8,
    out_buf: &mut [f64],
) -> usize {
    let dx = target_x - start_x;
    let dy = target_y - start_y;
    let distance = dx.hypot(dy);

    if distance < 4.0 || speed_profile == 2 {
        return 0;
    }

    let perp_x = -dy / distance;
    let perp_y = dx / distance;
    let curvature = sample_gaussian(0.0, distance * 0.12);

    let p1x = start_x + dx * 0.32 + perp_x * curvature;
    let p1y = start_y + dy * 0.32 + perp_y * curvature;

    let p2x = start_x + dx * 0.72 + perp_x * curvature * 0.6;
    let p2y = start_y + dy * 0.72 + perp_y * curvature * 0.6;

    let steps = if speed_profile == 1 {
        ((distance / 70.0).floor() as usize).clamp(3, 8)
    } else {
        ((distance / 45.0).floor() as usize).clamp(5, 14)
    };

    let max_steps = (out_buf.len() / 3).min(steps);
    for i in 1..=max_steps {
        let t = (i as f64) / (max_steps as f64);
        let eased_t = if t < 0.5 {
            2.0 * t * t
        } else {
            -1.0 + (4.0 - 2.0 * t) * t
        };
        let clamped_t = eased_t.clamp(0.0, 1.0);
        let (px, py) = evaluate_cubic_bezier(
            start_x, start_y, p1x, p1y, p2x, p2y, target_x, target_y, clamped_t,
        );

        let step_delay = match speed_profile {
            0 => sample_gaussian(5.0, 1.2).max(3.0),
            1 => sample_gaussian(2.5, 0.7).max(1.0),
            _ => 0.0,
        };

        let base = (i - 1) * 3;
        out_buf[base] = px;
        out_buf[base + 1] = py;
        out_buf[base + 2] = step_delay;
    }

    max_steps
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gaussian_distribution_bounds() {
        let sum: f64 = (0..2000).map(|_| sample_gaussian(500.0, 50.0)).sum();
        let mean = sum / 2000.0;
        assert!((mean - 500.0).abs() < 8.0, "Mean out of bounds: {mean}");
    }

    #[test]
    fn test_target_coordinate_clamping() {
        for _ in 0..1000 {
            let (x, y) = sample_target_coordinate(100.0, 100.0, 200.0, 60.0);
            assert!(x >= 103.0 && x <= 297.0);
            assert!(y >= 103.0 && y <= 157.0);
        }
    }

    #[test]
    fn test_cubic_bezier_endpoints() {
        let (x0, y0) = evaluate_cubic_bezier(0.0, 0.0, 10.0, 20.0, 30.0, 40.0, 50.0, 50.0, 0.0);
        let (x1, y1) = evaluate_cubic_bezier(0.0, 0.0, 10.0, 20.0, 30.0, 40.0, 50.0, 50.0, 1.0);
        assert_eq!((x0, y0), (0.0, 0.0));
        assert_eq!((x1, y1), (50.0, 50.0));
    }

    #[test]
    fn test_bezier_trajectory_buffer() {
        let mut buf = [0.0_f64; 48];
        let steps = compute_bezier_trajectory(0.0, 0.0, 200.0, 200.0, 1, &mut buf);
        assert!(steps >= 3 && steps <= 8);
        let last_base = (steps - 1) * 3;
        assert!((buf[last_base] - 200.0).abs() < 1e-6);
        assert!((buf[last_base + 1] - 200.0).abs() < 1e-6);
    }
}
