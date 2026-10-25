use sketch_solver::equations::Kind;
use sketch_solver::solve_buffer;

struct Builder { values: Vec<f64>, fixed: Vec<bool>, equations: Vec<(Kind, f64, Vec<usize>)> }

impl Builder {
    fn new() -> Self { Self { values: Vec::new(), fixed: Vec::new(), equations: Vec::new() } }
    fn point(&mut self, x: f64, y: f64, fixed: bool) -> [usize; 2] {
        self.values.extend([x, y]);
        self.fixed.extend([fixed, fixed]);
        [self.values.len() - 2, self.values.len() - 1]
    }
    fn equation(&mut self, kind: Kind, value: f64, operands: &[usize]) { self.equations.push((kind, value, operands.to_vec())); }
    fn encode(&self) -> Vec<f64> {
        let mut buffer = vec![1.0, self.values.len() as f64, self.equations.len() as f64];
        buffer.extend(&self.values);
        buffer.extend(self.fixed.iter().map(|&fixed| if fixed { 1.0 } else { 0.0 }));
        for (kind, value, operands) in &self.equations {
            buffer.push(Kind::ALL.iter().position(|k| k == kind).unwrap() as f64);
            buffer.push(*value);
            buffer.extend(operands.iter().map(|&o| o as f64));
        }
        buffer
    }
    /// `(status, iterations, values)`
    fn solve(&self) -> (f64, f64, Vec<f64>) {
        let output = solve_buffer(&self.encode());
        assert_eq!(output[0] as usize, output.len());
        assert_eq!(output[1], 1.0);
        (output[2], output[3], output[5..].to_vec())
    }
}

fn close(a: f64, b: f64) -> bool { (a - b).abs() < 1e-9 }

/// A 10 x 6 rectangle from a skewed start, one corner fixed.
fn rectangle(builder: &mut Builder) -> [[usize; 2]; 4] {
    let a = builder.point(0.0, 0.0, true);
    let b = builder.point(9.0, 1.0, false);
    let c = builder.point(11.0, 5.0, false);
    let d = builder.point(-1.0, 7.0, false);
    builder.equation(Kind::Difference, 0.0, &[a[1], b[1]]);
    builder.equation(Kind::Difference, 0.0, &[d[1], c[1]]);
    builder.equation(Kind::Difference, 0.0, &[a[0], d[0]]);
    builder.equation(Kind::Difference, 0.0, &[b[0], c[0]]);
    builder.equation(Kind::Distance, 10.0, &[a[0], a[1], b[0], b[1]]);
    builder.equation(Kind::Distance, 6.0, &[b[0], b[1], c[0], c[1]]);
    [a, b, c, d]
}

#[test]
fn solves_a_rectangle_exactly_and_keeps_fixed_values() {
    let mut builder = Builder::new();
    rectangle(&mut builder);
    let (status, iterations, values) = builder.solve();
    assert_eq!(status, 0.0);
    assert!(iterations <= 20.0);
    let expected = [0.0, 0.0, 10.0, 0.0, 10.0, 6.0, 0.0, 6.0];
    assert!(values.iter().zip(expected).all(|(&v, e)| close(v, e)), "{values:?}");
    assert_eq!(&values[..2], &[0.0, 0.0]);
}

#[test]
fn solves_angles_tangency_and_symmetry() {
    let mut builder = Builder::new();
    let v = builder.point(0.0, 0.0, true);
    let a = builder.point(10.0, 0.0, true);
    let b = builder.point(7.0, 9.0, false);
    builder.equation(Kind::Distance, 10.0, &[v[0], v[1], b[0], b[1]]);
    builder.equation(Kind::Angle, 60f64.to_radians(), &[v[0], v[1], a[0], a[1], v[0], v[1], b[0], b[1]]);
    // A mirror of `b` across the x axis through `v` and `a`.
    let m = builder.point(6.0, -7.0, false);
    builder.equation(Kind::SymmetricMidpoint, 0.0, &[b[0], b[1], m[0], m[1], v[0], v[1], a[0], a[1]]);
    builder.equation(Kind::SymmetricPerpendicular, 0.0, &[b[0], b[1], m[0], m[1], v[0], v[1], a[0], a[1]]);
    let (status, _, values) = builder.solve();
    assert_eq!(status, 0.0);
    let (x, y) = (5.0, 75f64.sqrt());
    assert!(close(values[b[0]], x) && close(values[b[1]], y), "{values:?}");
    assert!(close(values[m[0]], x) && close(values[m[1]], -y), "{values:?}");
}

#[test]
fn moves_only_constrained_directions_of_an_under_constrained_point() {
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let b = builder.point(10.0, 0.0, true);
    let p = builder.point(4.0, 3.0, false);
    builder.equation(Kind::PointOnLine, 0.0, &[p[0], p[1], a[0], a[1], b[0], b[1]]);
    let (status, _, values) = builder.solve();
    assert_eq!(status, 0.0);
    assert!(close(values[p[0]], 4.0) && close(values[p[1]], 0.0), "{values:?}");
}

#[test]
fn reports_conflicting_equations_as_not_converged() {
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let b = builder.point(3.0, 0.0, false);
    builder.equation(Kind::Distance, 5.0, &[a[0], a[1], b[0], b[1]]);
    builder.equation(Kind::Distance, 6.0, &[a[0], a[1], b[0], b[1]]);
    let (status, iterations, values) = builder.solve();
    assert_eq!(status, 1.0);
    assert!(iterations <= 100.0);
    assert!(values.iter().all(|v| v.is_finite()));
}

#[test]
fn solves_each_group_on_its_own_beside_a_conflicting_group() {
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let b = builder.point(3.0, 0.0, false);
    builder.equation(Kind::Distance, 5.0, &[a[0], a[1], b[0], b[1]]);
    builder.equation(Kind::Distance, 6.0, &[a[0], a[1], b[0], b[1]]);
    let corners = rectangle(&mut builder);
    let (status, _, values) = builder.solve();
    assert_eq!(status, 1.0);
    let expected = [0.0, 0.0, 10.0, 0.0, 10.0, 6.0, 0.0, 6.0];
    assert!(corners.iter().flatten().zip(expected).all(|(&p, e)| close(values[p], e)), "{values:?}");
}

#[test]
fn accepts_satisfied_redundant_equations_without_moving() {
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, false);
    let b = builder.point(0.0, 5.0, false);
    builder.equation(Kind::Difference, 0.0, &[a[0], b[0]]);
    builder.equation(Kind::Difference, 0.0, &[a[0], b[0]]);
    let (status, iterations, values) = builder.solve();
    assert_eq!((status, iterations), (0.0, 0.0));
    assert_eq!(values, vec![0.0, 0.0, 0.0, 5.0]);
}

#[test]
fn rejects_malformed_buffers() {
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, false);
    builder.equation(Kind::Value, 1.0, &[a[0]]);
    let valid = builder.encode();
    let invalid = |buffer: &[f64]| solve_buffer(buffer)[2] == 2.0;
    assert!(!invalid(&valid));
    assert!(invalid(&valid[..valid.len() - 1]));
    assert!(invalid(&[valid.clone(), vec![0.0]].concat()));
    for (index, bad) in [(0, 2.0), (1, 2.5), (3, f64::NAN), (5, 0.5), (7, 12.0), (8, f64::INFINITY), (9, 2.0)] {
        let mut buffer = valid.clone();
        buffer[index] = bad;
        assert!(invalid(&buffer), "index {index}");
    }
    let empty = solve_buffer(&[]);
    assert_eq!(&empty[..4], &[5.0, 1.0, 2.0, 0.0]);
    assert!(empty.len() == 5 && empty[4].is_nan());
}

#[test]
fn a_non_finite_residual_fails_whatever_follows_it() {
    for reversed in [false, true] {
        let mut builder = Builder::new();
        let a = builder.point(0.0, 0.0, true);
        let p = builder.point(1.0, 1.0, true);
        // A guide line of zero length has no direction; both equations have only fixed operands.
        let undefined = (Kind::PointOnLine, 0.0, vec![p[0], p[1], a[0], a[1], a[0], a[1]]);
        let satisfied = (Kind::Value, 1.0, vec![p[0]]);
        builder.equations = if reversed { vec![satisfied, undefined] } else { vec![undefined, satisfied] };
        assert_eq!(builder.solve().0, 1.0, "reversed: {reversed}");
    }
}

#[test]
fn an_operand_repeated_in_one_equation_has_one_combined_derivative() {
    // Two lines sharing both endpoints: their angle is identically zero and cannot reach 0.001 degrees.
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let b = builder.point(1e-6, 0.0, false);
    builder.equation(Kind::Angle, 0.001f64.to_radians(), &[a[0], a[1], b[0], b[1], a[0], a[1], b[0], b[1]]);
    assert_eq!(builder.solve().0, 1.0);
}

#[test]
fn polishes_an_ill_conditioned_intersection_to_roundoff() {
    // An arc's end on a circle that nearly touches the arc's own circle.
    let mut builder = Builder::new();
    let center = builder.point(-1.0, 0.0, true);
    let start = builder.point(0.0, -1e-6, true);
    let end = builder.point(0.01, 1.1e-5, false);
    let other = builder.point(1.0, 0.0, true);
    builder.equation(Kind::EqualLength, 0.0, &[center[0], center[1], start[0], start[1], center[0], center[1], end[0], end[1]]);
    builder.equation(Kind::Distance, 1f64.hypot(1e-6), &[other[0], other[1], end[0], end[1]]);
    let (status, _, values) = builder.solve();
    assert_eq!(status, 0.0);
    let radius = |x: f64, y: f64| (x + 1.0).hypot(y);
    assert!((radius(values[end[0]], values[end[1]]) - radius(0.0, -1e-6)).abs() <= 1e-12, "{values:?}");
}

#[test]
fn a_cancelled_angle_far_from_the_origin_is_not_accepted() {
    let mut builder = Builder::new();
    let a = builder.point(1e6, 0.0, true);
    let b = builder.point(1e6 + 1.0, 0.0, false);
    builder.equation(Kind::Angle, 0.001f64.to_radians(), &[a[0], a[1], b[0], b[1], a[0], a[1], b[0], b[1]]);
    assert_eq!(builder.solve().0, 1.0);
}

#[test]
fn a_short_fixed_guide_neither_hides_nor_excuses_an_angle() {
    for movable in [true, false] {
        let mut builder = Builder::new();
        let origin = builder.point(0.0, 0.0, true);
        let guide = builder.point(1e-6, 0.0, true);
        let end = builder.point(10000.0, 10000.0, !movable);
        builder.equation(Kind::Angle, 30f64.to_radians(), &[origin[0], origin[1], guide[0], guide[1], origin[0], origin[1], end[0], end[1]]);
        let (status, iterations, values) = builder.solve();
        if movable {
            assert_eq!(status, 0.0);
            assert!(iterations <= 10.0, "{iterations} iterations");
            assert!((values[end[1]].atan2(values[end[0]]) - 30f64.to_radians()).abs() <= 1e-12, "{values:?}");
        } else {
            assert_eq!(status, 1.0);
        }
    }
}

#[test]
fn a_point_moved_onto_a_line_far_from_the_origin_does_not_slide_along_it() {
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let b = builder.point(1.0, 1.0, true);
    let p = builder.point(500000.0, 500000.00001, false);
    builder.equation(Kind::PointOnLine, 0.0, &[p[0], p[1], a[0], a[1], b[0], b[1]]);
    let (status, _, values) = builder.solve();
    assert_eq!(status, 0.0);
    assert!((values[p[0]] - 500000.000005).abs() <= 1e-9 && (values[p[1]] - 500000.000005).abs() <= 1e-9, "{values:?}");
}

#[test]
fn corrects_tiny_geometry_below_the_unit_roundoff() {
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let b = builder.point(1.0, 0.0, true);
    let end = builder.point(1e-5, 1e-16, true);
    builder.fixed[end[1]] = false;
    builder.equation(Kind::Parallel, 0.0, &[a[0], a[1], b[0], b[1], a[0], a[1], end[0], end[1]]);
    let (status, _, values) = builder.solve();
    assert_eq!(status, 0.0);
    assert!(values[end[1]].abs() <= 1e-20, "{values:?}");
}

#[test]
fn accepts_angles_of_short_lines_far_from_the_origin_to_their_roundoff() {
    for index in 0..60 {
        let mut builder = Builder::new();
        let a = builder.point(500000.0, 500000.0, true);
        let b = builder.point(500001.0, 500000.0, true);
        let origin = builder.point(500003.0, 500000.0, true);
        let target = (3.0 + index as f64 * 2.9).to_radians();
        let end = builder.point(500003.0 + (target + 0.01).cos(), 500000.0 + (target + 0.01).sin(), false);
        builder.equation(Kind::Angle, target, &[a[0], a[1], b[0], b[1], origin[0], origin[1], end[0], end[1]]);
        assert_eq!(builder.solve().0, 0.0, "{} degrees", target.to_degrees());
    }
    let mut builder = Builder::new();
    let a = builder.point(500000.0, 500000.0, true);
    let b = builder.point(500001.0, 500000.0, true);
    let origin = builder.point(500003.0, 500000.0, true);
    let end = builder.point(500003.5475710479, 500000.8374232256, false);
    builder.equation(Kind::Angle, 60.16056848758241f64.to_radians(), &[a[0], a[1], b[0], b[1], origin[0], origin[1], end[0], end[1]]);
    assert_eq!(builder.solve().0, 0.0);
}

#[test]
fn polishes_an_input_that_starts_within_acceptance() {
    let mut builder = Builder::new();
    let center = builder.point(-100.0, 0.0, true);
    let start = builder.point(0.0, -1e-5, true);
    let end = builder.point(0.0, 4e-5, false);
    let other = builder.point(100.0, 0.0, true);
    builder.equation(Kind::EqualLength, 0.0, &[center[0], center[1], start[0], start[1], center[0], center[1], end[0], end[1]]);
    builder.equation(Kind::Distance, 100f64.hypot(1e-5), &[other[0], other[1], end[0], end[1]]);
    let (status, _, values) = builder.solve();
    assert_eq!(status, 0.0);
    let radius = |x: f64, y: f64| (x + 100.0).hypot(y);
    assert!((radius(values[end[0]], values[end[1]]) - radius(0.0, -1e-5)).abs() <= 1e-12, "{values:?}");
}

#[test]
fn polishes_a_near_tangent_intersection_quickly_beside_other_unknowns() {
    let mut builder = Builder::new();
    let center = builder.point(-100.0, 0.0, true);
    let start = builder.point(0.0, -1e-5, true);
    let end = builder.point(1.0, 1.0, false);
    let other = builder.point(100.0, 0.0, true);
    builder.equation(Kind::EqualLength, 0.0, &[center[0], center[1], start[0], start[1], center[0], center[1], end[0], end[1]]);
    builder.equation(Kind::Distance, 100f64.hypot(1e-5), &[other[0], other[1], end[0], end[1]]);
    let mut previous = end;
    for index in 0..100 {
        let next = builder.point(index as f64 * 0.7, 3.0, false);
        builder.equation(Kind::Difference, 1.0, &[previous[0], next[0]]);
        builder.equation(Kind::Difference, 0.0, &[previous[1], next[1]]);
        previous = next;
    }
    let (status, iterations, values) = builder.solve();
    assert_eq!(status, 0.0);
    assert!(iterations <= 40.0, "{iterations} iterations");
    let radius = |x: f64, y: f64| (x + 100.0).hypot(y);
    assert!((radius(values[end[0]], values[end[1]]) - radius(0.0, -1e-5)).abs() <= 1e-12, "{values:?}");
}
