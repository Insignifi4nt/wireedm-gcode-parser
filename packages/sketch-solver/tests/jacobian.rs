use sketch_solver::dual::Dual;
use sketch_solver::equations::{Kind, residual};

/// Deterministic generator; the tests must not depend on a crate.
struct Random(u64);
impl Random {
    fn next(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 11) as f64 / (1u64 << 53) as f64 * 40.0 - 20.0
    }
}

fn value(kind: Kind, operands: &[f64], target: f64) -> f64 {
    let duals: Vec<Dual> = operands.iter().map(|&v| Dual::constant(v)).collect();
    residual(kind, &duals, target).value
}

#[test]
fn every_kind_matches_central_differences() {
    let mut random = Random(0x9e37_79b9_7f4a_7c15);
    for kind in Kind::ALL {
        for _ in 0..200 {
            let operands: Vec<f64> = (0..kind.arity()).map(|_| random.next()).collect();
            let target = random.next() * 0.1;
            let duals: Vec<Dual> = operands.iter().enumerate().map(|(slot, &v)| Dual::variable(v, slot)).collect();
            let exact = residual(kind, &duals, target);
            assert!((exact.value - value(kind, &operands, target)).abs() == 0.0);
            for slot in 0..kind.arity() {
                let step = 1e-6 * operands[slot].abs().max(1.0);
                let (mut plus, mut minus) = (operands.clone(), operands.clone());
                plus[slot] += step;
                minus[slot] -= step;
                let (high, low) = (value(kind, &plus, target), value(kind, &minus, target));
                // The angle wraps; skip a difference that straddles the branch cut.
                if (high - low).abs() > 1.0 { continue; }
                let numeric = (high - low) / (2.0 * step);
                let error = (numeric - exact.gradient[slot]).abs();
                assert!(error <= 1e-6 * exact.gradient[slot].abs().max(1.0), "{kind:?} slot {slot}: {numeric} vs {}", exact.gradient[slot]);
            }
        }
    }
}

#[test]
fn residuals_vanish_on_satisfied_geometry() {
    let cases: [(Kind, &[f64], f64); 13] = [
        (Kind::Difference, &[2.0, 7.0], 5.0),
        (Kind::Value, &[3.5], 3.5),
        (Kind::Midpoint, &[1.0, 5.0, 3.0], 0.0),
        (Kind::Distance, &[0.0, 0.0, 3.0, 4.0], 5.0),
        (Kind::DistanceToParameter, &[1.0, 1.0, 4.0, 5.0, 5.0], 0.0),
        (Kind::PointOnLine, &[5.0, 5.0, 0.0, 0.0, 2.0, 2.0], 0.0),
        (Kind::Parallel, &[0.0, 0.0, 1.0, 2.0, 5.0, 5.0, 3.0, 1.0], 0.0),
        (Kind::Perpendicular, &[0.0, 0.0, 1.0, 2.0, 5.0, 5.0, 7.0, 4.0], 0.0),
        (Kind::Angle, &[0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 2.0], std::f64::consts::FRAC_PI_2),
        (Kind::EqualLength, &[0.0, 0.0, 3.0, 4.0, 1.0, 1.0, 1.0, 6.0], 0.0),
        (Kind::SymmetricMidpoint, &[-2.0, 3.0, 4.0, 3.0, 1.0, 0.0, 1.0, 9.0], 0.0),
        (Kind::SymmetricPerpendicular, &[-2.0, 3.0, 4.0, 3.0, 1.0, 0.0, 1.0, 9.0], 0.0),
        (Kind::PointLineDistance, &[1.0, 5.0, 0.0, 0.0, 4.0, 0.0], 5.0),
    ];
    for (kind, operands, target) in cases {
        assert!(value(kind, operands, target).abs() < 1e-14, "{kind:?}");
    }
}

#[test]
fn angles_wrap_into_one_turn_and_keep_their_sign() {
    let ray = |degrees: f64| [0.0, 0.0, 1.0, 0.0, 0.0, 0.0, degrees.to_radians().cos(), degrees.to_radians().sin()];
    assert!((value(Kind::Angle, &ray(-30.0), 330f64.to_radians())).abs() < 1e-12);
    assert!((value(Kind::Angle, &ray(170.0), -170f64.to_radians()) - (-20f64).to_radians()).abs() < 1e-12);
    assert!((value(Kind::Angle, &ray(30.0), -30f64.to_radians()) - 60f64.to_radians()).abs() < 1e-12);
}

#[test]
fn zero_lengths_have_finite_gradients() {
    let duals: Vec<Dual> = [1.0, 1.0, 1.0, 1.0].iter().enumerate().map(|(slot, &v)| Dual::variable(v, slot)).collect();
    let result = residual(Kind::Distance, &duals, 2.0);
    assert_eq!(result.value, -2.0);
    assert!(result.gradient.iter().all(|g| g.is_finite()));
}

#[test]
fn a_point_line_distance_is_signed_by_the_side_of_the_line() {
    // Left of a to b is positive; reversing the line flips the sign, not the length.
    let line = |p: [f64; 2], forward: bool| if forward { [p[0], p[1], 0.0, 0.0, 4.0, 0.0] } else { [p[0], p[1], 4.0, 0.0, 0.0, 0.0] };
    assert_eq!(value(Kind::PointLineDistance, &line([1.0, 3.0], true), 3.0), 0.0);
    assert_eq!(value(Kind::PointLineDistance, &line([1.0, -3.0], true), -3.0), 0.0);
    assert_eq!(value(Kind::PointLineDistance, &line([1.0, 3.0], false), -3.0), 0.0);
    assert_eq!(value(Kind::PointLineDistance, &line([1.0, 3.0], true), 2.0), 1.0);
    // The support is infinite: a point past either end measures to its extension.
    assert_eq!(value(Kind::PointLineDistance, &line([9.0, 2.0], true), 2.0), 0.0);
    // Far from the origin the residual keeps its accuracy relative to the operands.
    let far = [1e6 + 1.0, 2e6 + 3.0, 1e6, 2e6, 1e6 + 4.0, 2e6];
    assert!(value(Kind::PointLineDistance, &far, 3.0).abs() < 1e-9);
}

#[test]
fn a_point_line_distance_to_a_zero_length_line_is_not_finite() {
    let duals: Vec<Dual> = [1.0, 1.0, 2.0, 2.0, 2.0, 2.0].iter().enumerate().map(|(slot, &v)| Dual::variable(v, slot)).collect();
    assert!(!residual(Kind::PointLineDistance, &duals, 1.0).value.is_finite());
}
