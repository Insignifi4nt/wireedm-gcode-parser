//! The column map, which only systems built inside the solver use.

use super::*;
use crate::problem::Equation;

fn equation(kind: Kind, value: f64, tag: usize, operands: &[usize]) -> Equation {
    Equation { kind, value, tag, temporary: false, operands: operands.to_vec() }
}

/// p = (x0, y0) and q = (x1, y1), with q held 3 right of and 4 below p, and each at its own distance
/// from the fixed origin (x2, y2): p at 5 and q at 6, which (3, 4) and (6, 0) meet, crossing.
fn offset_points() -> Problem {
    Problem { values: vec![3.2, 3.9, 6.1, -0.05, 0.0, 0.0], fixed: vec![false, false, false, false, true, true], equations: vec![
        equation(Kind::Difference, 3.0, 0, &[0, 2]), equation(Kind::Difference, -4.0, 1, &[1, 3]),
        equation(Kind::Distance, 5.0, 2, &[4, 5, 0, 1]), equation(Kind::Distance, 6.0, 3, &[4, 5, 2, 3])], definition: false }
}

fn columns(problem: &Problem, unknowns: &[usize]) -> Vec<usize> {
    let mut column = vec![usize::MAX; problem.values.len()];
    for (c, &p) in unknowns.iter().enumerate() { column[p] = c; }
    column
}

#[test]
fn a_map_that_moves_each_parameter_alone_solves_as_no_map() {
    let problem = offset_points();
    let column = columns(&problem, &[0, 1, 2, 3]);
    let identity = ColumnMap { scale: vec![1.0; 4], followers: Vec::new() };
    let solved = |map| {
        let system = System { problem: &problem, column: &column, equations: vec![0, 1, 2, 3], unknowns: vec![0, 1, 2, 3], map };
        let mut values = problem.values.clone();
        let outcome = solve_group(&system, &mut values, LIMITS);
        (values, outcome.status, outcome.iterations, outcome.residual.to_bits(), outcome.position)
    };
    let (unmapped, mapped) = (solved(None), solved(Some(&identity)));
    assert_eq!(unmapped.1, Status::Converged);
    assert_eq!(unmapped.0.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), mapped.0.iter().map(|v| v.to_bits()).collect::<Vec<_>>());
    assert_eq!((unmapped.1, unmapped.2, unmapped.3, unmapped.4), (mapped.1, mapped.2, mapped.3, mapped.4));
}

#[test]
fn a_column_moves_its_class_and_solves_the_rows_left() {
    let problem = offset_points();
    // x0 and x1 move as one column, y0 and y1 as another, each scaled by one over the square root
    // of its two members; only the distances are solved.
    let mut column = columns(&problem, &[0, 1]);
    column[2] = 0;
    column[3] = 1;
    let map = ColumnMap { scale: vec![std::f64::consts::FRAC_1_SQRT_2; 2], followers: vec![(2, 0, 3.0), (3, 1, -4.0)] };
    let system = System { problem: &problem, column: &column, equations: vec![2, 3], unknowns: vec![0, 1], map: Some(&map) };
    let mut values = problem.values.clone();
    // Each class starts at the mean of its members less their offsets.
    values[0] = (values[0] + values[2] - 3.0) / 2.0;
    values[1] = (values[1] + values[3] + 4.0) / 2.0;
    system.expand(&mut values);
    let outcome = solve_group(&system, &mut values, LIMITS);
    assert_eq!(outcome.status, Status::Converged);
    for (value, expected) in values.iter().zip([3.0, 4.0, 6.0, 0.0]) { assert!((value - expected).abs() <= 1e-12, "{values:?}"); }
    // Followers are set from their column's parameter, so the eliminated rows hold to roundoff.
    assert_eq!(values[2], values[0] + 3.0);
    assert_eq!(values[3], values[1] - 4.0);
    // The whole system accepts the result, and its rows are met.
    let whole = System { problem: &problem, column: &columns(&problem, &[0, 1, 2, 3]), equations: vec![0, 1, 2, 3], unknowns: vec![0, 1, 2, 3], map: None };
    assert!(assess(&whole.rows(&values, None)).accepted);
}

#[test]
fn a_scaled_column_has_the_derivatives_of_its_members_times_the_scale() {
    let problem = offset_points();
    let mut column = columns(&problem, &[0, 1]);
    column[2] = 0;
    column[3] = 1;
    let map = ColumnMap { scale: vec![0.5, 0.25], followers: vec![(2, 0, 3.0), (3, 1, -4.0)] };
    let system = System { problem: &problem, column: &column, equations: vec![3], unknowns: vec![0, 1], map: Some(&map) };
    let mut values = problem.values.clone();
    system.expand(&mut values);
    // |q| = 6 with q = (x0 + 3, y0 - 4): d|q|/dx0 = qx / |q|, d|q|/dy0 = qy / |q|, before weighting.
    let row = &system.rows(&values, None)[0];
    let (qx, qy) = (values[2], values[3]);
    let length = qx.hypot(qy);
    let expected = [0.5 * qx / length, 0.25 * qy / length];
    let norm = expected[0].hypot(expected[1]);
    assert_eq!(&row.columns[..row.len], &[0, 1]);
    for (derivative, expected) in row.derivatives[..row.len].iter().zip(expected) { assert!((derivative - expected / norm).abs() <= 1e-15, "{:?}", row.derivatives); }
}
