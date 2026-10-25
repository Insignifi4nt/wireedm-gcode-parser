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
