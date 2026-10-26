mod common;

use common::Builder;
use sketch_solver::diagnose::{CONFLICTING, REDUNDANT, Row, TAU, dependent};
use sketch_solver::equations::Kind;
use sketch_solver::newton::Limits;
use sketch_solver::problem::{Diagnosis, Status};

/// `(diagnosis, degrees of freedom, labels)`
fn diagnose(builder: &Builder) -> (Diagnosis, Option<usize>, Vec<u8>) {
    let (outcome, _) = builder.outcome();
    (outcome.diagnosis, outcome.degrees_of_freedom, outcome.labels)
}

/// Two free points 5 apart on a horizontal, the first fixed by value: `[a, b]`.
fn segment(builder: &mut Builder) -> [[usize; 2]; 2] {
    let a = builder.point(0.1, -0.2, false);
    let b = builder.point(4.0, 1.0, false);
    builder.equation(Kind::Value, 0.0, &[a[0]]);
    builder.equation(Kind::Value, 0.0, &[a[1]]);
    builder.equation(Kind::Difference, 0.0, &[a[1], b[1]]);
    [a, b]
}

#[test]
fn freedom_is_the_unknowns_less_the_rank_including_unreferenced_ones() {
    let mut builder = Builder::new();
    let [a, b] = segment(&mut builder);
    assert_eq!(diagnose(&builder), (Diagnosis::Diagnosed, Some(1), vec![0; 3]));
    builder.equation(Kind::Distance, 5.0, &[a[0], a[1], b[0], b[1]]);
    assert_eq!(diagnose(&builder), (Diagnosis::Diagnosed, Some(0), vec![0; 4]));
    builder.point(3.0, 3.0, false);
    builder.point(3.0, 3.0, true);
    assert_eq!(diagnose(&builder).1, Some(2));
}

#[test]
fn a_repeated_dimension_is_redundant_when_it_agrees_and_both_conflict_when_not() {
    for (second, expected) in [(5.0, (Some(0), vec![0, 0, 0, 0, REDUNDANT])), (6.0, (None, vec![0, 0, 0, CONFLICTING, CONFLICTING]))] {
        let mut builder = Builder::new();
        let [a, b] = segment(&mut builder);
        builder.equation(Kind::Distance, 5.0, &[a[0], a[1], b[0], b[1]]);
        builder.equation(Kind::Distance, second, &[a[0], a[1], b[0], b[1]]);
        let (diagnosis, dof, labels) = diagnose(&builder);
        assert_eq!((diagnosis, dof, labels), (Diagnosis::Diagnosed, expected.0, expected.1), "second {second}");
    }
}

#[test]
fn an_equation_of_a_constraint_with_fewer_equations_is_set_aside_first() {
    // A coincidence and a horizontal, in either order: the horizontal is redundant, as in PlaneGCS.
    for coincidence_first in [true, false] {
        let mut builder = Builder::new();
        let p = builder.point(0.0, 0.0, true);
        let q = builder.point(1.0, 2.0, false);
        let coincidence = |builder: &mut Builder| {
            builder.equation(Kind::Difference, 0.0, &[p[0], q[0]]);
            builder.same(Kind::Difference, 0.0, &[p[1], q[1]]);
        };
        if coincidence_first { coincidence(&mut builder); }
        builder.equation(Kind::Difference, 0.0, &[p[1], q[1]]);
        if !coincidence_first { coincidence(&mut builder); }
        let expected = if coincidence_first { vec![0, 0, REDUNDANT] } else { vec![REDUNDANT, 0, 0] };
        assert_eq!(diagnose(&builder), (Diagnosis::Diagnosed, Some(0), expected), "coincidence first: {coincidence_first}");
    }
}

#[test]
fn witnesses_in_separate_groups_are_covered_across_groups() {
    // A coincidence, then a vertical and a horizontal on the same points. The x and y equations
    // form separate groups; the vertical and the horizontal are each set aside in theirs.
    let mut builder = Builder::new();
    let p = builder.point(0.0, 0.0, true);
    let q = builder.point(1.0, 2.0, false);
    builder.equation(Kind::Difference, 0.0, &[p[0], q[0]]);
    builder.same(Kind::Difference, 0.0, &[p[1], q[1]]);
    builder.equation(Kind::Difference, 0.0, &[p[0], q[0]]);
    builder.equation(Kind::Difference, 0.0, &[p[1], q[1]]);
    assert_eq!(diagnose(&builder), (Diagnosis::Diagnosed, Some(0), vec![0, 0, REDUNDANT, REDUNDANT]));
}

#[test]
fn a_redundant_equation_clears_its_witness_though_its_constraint_conflicts_elsewhere() {
    // A horizontal, a coincidence and an x offset of 3, as PlaneGCS reports them: the horizontal
    // repeats the coincidence's y and is redundant; the coincidence's x conflicts with the offset.
    let mut builder = Builder::new();
    let p = builder.point(0.0, 0.0, true);
    let q = builder.point(1.0, 2.0, false);
    builder.equation(Kind::Difference, 0.0, &[p[1], q[1]]);
    builder.equation(Kind::Difference, 0.0, &[p[0], q[0]]);
    builder.same(Kind::Difference, 0.0, &[p[1], q[1]]);
    builder.equation(Kind::Difference, 3.0, &[p[0], q[0]]);
    assert_eq!(diagnose(&builder), (Diagnosis::Diagnosed, None, vec![REDUNDANT, CONFLICTING, CONFLICTING, CONFLICTING]));
}

#[test]
fn relations_without_unknowns_conflict_when_not_met_and_are_redundant_beside_unknowns_when_met() {
    for (value, label, dof) in [(5.0, REDUNDANT, Some(2)), (4.0, CONFLICTING, None)] {
        let mut builder = Builder::new();
        let a = builder.point(0.0, 0.0, true);
        let b = builder.point(3.0, 4.0, true);
        builder.equation(Kind::Distance, value, &[a[0], a[1], b[0], b[1]]);
        // With nothing free, a met relation has nothing to be redundant to.
        assert_eq!(diagnose(&builder), (Diagnosis::NoUnknowns, None, vec![if label == CONFLICTING { label } else { 0 }]));
        builder.point(1.0, 1.0, false);
        assert_eq!(diagnose(&builder), (Diagnosis::Diagnosed, dof, vec![label]), "value {value}");
    }
}

#[test]
fn a_temporary_target_is_solved_but_not_diagnosed() {
    let mut builder = Builder::new();
    let [_, b] = segment(&mut builder);
    builder.temporary(Kind::Value, 3.0, &[b[0]]);
    let (outcome, values) = builder.outcome();
    assert!((values[b[0]] - 3.0).abs() < 1e-9);
    assert_eq!((outcome.diagnosis, outcome.degrees_of_freedom, outcome.labels), (Diagnosis::Diagnosed, Some(1), vec![0; 4]));
}

#[test]
fn a_group_beyond_the_limits_is_not_diagnosed() {
    let mut builder = Builder::new();
    let [a, b] = segment(&mut builder);
    builder.equation(Kind::Distance, 5.0, &[a[0], a[1], b[0], b[1]]);
    let (outcome, _) = builder.outcome_within(Limits { fill: 1, work: usize::MAX });
    assert_eq!((outcome.diagnosis, outcome.degrees_of_freedom, outcome.labels), (Diagnosis::Unavailable, None, vec![0; 4]));
}

#[test]
fn dimensions_that_cannot_add_up_all_conflict() {
    // Points on a horizontal cannot be 3, 4 and 8 apart.
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let b = builder.point(3.0, 0.1, false);
    let c = builder.point(7.0, 0.0, false);
    builder.equation(Kind::Difference, 0.0, &[a[1], b[1]]);
    builder.equation(Kind::Difference, 0.0, &[a[1], c[1]]);
    builder.equation(Kind::Difference, 3.0, &[a[0], b[0]]);
    builder.equation(Kind::Difference, 4.0, &[b[0], c[0]]);
    builder.equation(Kind::Difference, 8.0, &[a[0], c[0]]);
    let (diagnosis, dof, labels) = diagnose(&builder);
    assert_eq!((diagnosis, dof), (Diagnosis::Diagnosed, None));
    assert_eq!(labels, vec![0, 0, CONFLICTING, CONFLICTING, CONFLICTING]);
}

#[test]
fn each_repeated_relation_is_set_aside_rather_than_a_shared_earlier_one() {
    // Fixed points, by one value equation per axis, a midpoint between two of them, and two
    // horizontals through it in either order. Both dependencies run through the first fixed
    // points' y values; the horizontals are what repeats.
    for midpoint_first in [true, false] {
        let mut builder = Builder::new();
        let fixed = |builder: &mut Builder, x: f64, y: f64| {
            let p = builder.point(x, y, false);
            builder.equation(Kind::Value, x, &[p[0]]);
            builder.equation(Kind::Value, y, &[p[1]]);
            p
        };
        let (a, b, c, e) = (fixed(&mut builder, 0.0, 0.0), fixed(&mut builder, 4.0, 2.0), fixed(&mut builder, 10.0, 1.0), fixed(&mut builder, -10.0, 1.0));
        let m = builder.point(1.5, 1.5, false);
        let midpoint = |builder: &mut Builder| {
            builder.equation(Kind::Midpoint, 0.0, &[a[0], b[0], m[0]]);
            builder.same(Kind::Midpoint, 0.0, &[a[1], b[1], m[1]]);
        };
        if midpoint_first { midpoint(&mut builder); }
        builder.equation(Kind::Difference, 0.0, &[m[1], c[1]]);
        builder.equation(Kind::Difference, 0.0, &[m[1], e[1]]);
        if !midpoint_first { midpoint(&mut builder); }
        let mut expected = vec![0; 12];
        let horizontals = if midpoint_first { 10 } else { 8 };
        expected[horizontals..horizontals + 2].fill(REDUNDANT);
        assert_eq!(diagnose(&builder), (Diagnosis::Diagnosed, Some(0), expected), "midpoint first: {midpoint_first}");
    }
}

#[test]
fn a_nearly_parallel_guide_is_not_blamed_for_its_neighbour() {
    // A far point on a guide, a guide turned by about 4e-7 rad, the first again and a parallel
    // guide 5 along. The turned guide's coefficient in either witness is roundoff (about 2e-10
    // here, epsilon times the pair's condition), above the pruning level, and the first guide
    // reproduces both repeats without it.
    let mut builder = Builder::new();
    let p = builder.point(2222223.888889, -1666666.666667, false);
    for (a, b) in [((0.0, 0.0), (0.8, -0.6)), ((0.0, 0.0), (0.8000006, -0.6)), ((0.0, 0.0), (0.8, -0.6)), ((5.0, 0.0), (5.8, -0.6))] {
        let a = builder.point(a.0, a.1, true);
        let b = builder.point(b.0, b.1, true);
        builder.equation(Kind::PointOnLine, 0.0, &[p[0], p[1], a[0], a[1], b[0], b[1]]);
    }
    assert_eq!(diagnose(&builder), (Diagnosis::Diagnosed, None, vec![CONFLICTING, 0, REDUNDANT, CONFLICTING]));
}

#[test]
fn diagnosis_shares_the_work_limit_of_its_group() {
    // The smallest limits that converge and that diagnose, from a solved start and after a solve:
    // diagnosing after a solve needs the solve's work and its own.
    let least = |start: f64| {
        let mut builder = Builder::new();
        let x = builder.parameter(start, false);
        builder.equation(Kind::Value, 0.0, &[x]);
        let outcomes: Vec<_> = (0..1000).map(|work| builder.outcome_within(Limits { fill: usize::MAX, work }).0).collect();
        let converged = outcomes.iter().position(|outcome| outcome.status == Status::Converged).unwrap();
        let diagnosed = outcomes.iter().position(|outcome| outcome.diagnosis == Diagnosis::Diagnosed).unwrap();
        assert!(outcomes[diagnosed..].iter().all(|outcome| outcome.diagnosis == Diagnosis::Diagnosed));
        (converged, diagnosed)
    };
    let ((_, alone), (solved, diagnosed)) = (least(0.0), least(1.0));
    assert!(solved > 0 && diagnosed >= solved + alone, "solve {solved}, diagnosis alone {alone}, both {diagnosed}");
}

/// Unknowns x, y, z from `start`, and in order `x = 0`, `x + 1e-6 y = 0`, `z = 0` when `pinned`,
/// `y + 5e-5 z = 1` and `x = z` when `pinned`.
fn weak(start: [f64; 3], pinned: bool, lean: f64) -> (Diagnosis, Option<usize>, Vec<u8>) {
    let mut builder = Builder::new();
    let [x, y, z] = start.map(|value| builder.parameter(value, false));
    let o = builder.point(0.0, 0.0, true);
    let d = builder.point(1e-6, -1.0, true);
    let a = builder.point(1.0, 0.0, true);
    let e = builder.point(1.0 + lean, -1.0, true);
    builder.equation(Kind::Value, 0.0, &[x]);
    builder.equation(Kind::PointOnLine, 0.0, &[x, y, o[0], o[1], d[0], d[1]]);
    if pinned { builder.equation(Kind::Value, 0.0, &[z]); }
    builder.equation(Kind::PointOnLine, 0.0, &[y, z, a[0], a[1], e[0], e[1]]);
    if pinned { builder.equation(Kind::Difference, 0.0, &[x, z]); }
    diagnose(&builder)
}

#[test]
fn a_weakly_held_direction_is_not_blamed_on_a_relation() {
    // These hold z = 2e4, but moving z by 1 mm breaks `x = 0` by only 5e-11 mm, so the rows are
    // dependent within TAU relative to their coefficients of about 1e6. That combination
    // reproduces the last row only to 5e-5, so its residuals are not constant and cannot tell
    // redundant from conflicting: rank is unclear, so the solved sketch blames nothing and its
    // freedom is unknown.
    assert_eq!(weak([0.0, 0.0, 2e4], false, 5e-5), (Diagnosis::Uncertain, None, vec![0; 3]));
}

#[test]
fn a_repeated_dimension_beside_a_near_tangency_is_still_redundant() {
    // p 1.4e-8 mm from where its circle about the origin touches x = 10: rank there is too close to
    // call, so freedom is unknown, but a repeated distance to q is still found, before or after it.
    for tangency_first in [true, false] {
        let mut builder = Builder::new();
        let o = builder.point(0.0, 0.0, true);
        let p = builder.point(10.0, 1.4e-8, false);
        let q = builder.point(10.0, 5.0, false);
        let tangency = |builder: &mut Builder| {
            builder.equation(Kind::Distance, 10.0, &[o[0], o[1], p[0], p[1]]);
            builder.equation(Kind::Value, 10.0, &[p[0]]);
        };
        if tangency_first { tangency(&mut builder); }
        builder.equation(Kind::Distance, 5.0, &[p[0], p[1], q[0], q[1]]);
        builder.equation(Kind::Distance, 5.0, &[p[0], p[1], q[0], q[1]]);
        if !tangency_first { tangency(&mut builder); }
        let expected = if tangency_first { vec![0, 0, 0, REDUNDANT] } else { vec![0, REDUNDANT, 0, 0] };
        assert_eq!(diagnose(&builder), (Diagnosis::Uncertain, None, expected), "tangency first {tangency_first}");
    }
}

#[test]
fn a_relation_needed_by_a_conflict_is_not_dropped_from_its_witness() {
    // With `z = 0` the first four conflict, and `x = z` repeats `x = 0` and `z = 0`. Its
    // coefficient in the fourth row's witness is small beside the others, about 1e6, but without
    // it they reproduce that row only to 5e-5, so it stays.
    assert_eq!(weak([0.3, 0.7, 0.1], true, 5e-5), (Diagnosis::Diagnosed, None, vec![CONFLICTING, CONFLICTING, CONFLICTING, CONFLICTING, REDUNDANT]));
}

#[test]
fn a_relation_needed_by_a_conflict_is_kept_where_the_others_miss_it_by_little() {
    // With a lean of 1e-9 the others miss the fourth row by 1e-9 in z, where none of them has
    // an entry; roundoff of their large terms in other columns does not excuse that.
    assert_eq!(weak([0.3, 0.7, 0.1], true, 1e-9), (Diagnosis::Diagnosed, None, vec![CONFLICTING, CONFLICTING, CONFLICTING, CONFLICTING, REDUNDANT]));
}

#[test]
fn a_relation_repeating_two_nearly_parallel_ones_is_redundant() {
    // Guides 1e-3 apart in direction fix the point; `y = 0` repeats them. Seminormal equations
    // alone miss it by more than the reconstruction allows, so the coefficients are corrected.
    let mut builder = Builder::new();
    let p = builder.point(0.0, 0.0, false);
    let o = builder.point(0.0, 0.0, true);
    for x in [0.6, 0.599] {
        let d = builder.point(x, -0.8, true);
        builder.equation(Kind::PointOnLine, 0.0, &[p[0], p[1], o[0], o[1], d[0], d[1]]);
    }
    builder.equation(Kind::Value, 0.0, &[p[1]]);
    assert_eq!(diagnose(&builder), (Diagnosis::Diagnosed, Some(0), vec![0, 0, REDUNDANT]));
}

#[test]
fn a_spurious_guide_is_not_kept_where_its_neighbours_terms_cancel() {
    // p on a vertical guide and on a guide tilted 5e-6 beside it, q on the tilted one directly
    // above p: only the last four conflict. The vertical guide's coefficient is roundoff, and the
    // terms of the others cancel, so the rest must be judged to far below that roundoff.
    let mut builder = Builder::new();
    let p = builder.point(0.0, 0.0, false);
    let q = builder.point(0.0, 1.0, false);
    let o = builder.point(0.0, 0.0, true);
    let vertical = builder.point(0.0, -2.0, true);
    let tilted = builder.point(1e-5, -2.0, true);
    builder.equation(Kind::PointOnLine, 0.0, &[p[0], p[1], o[0], o[1], vertical[0], vertical[1]]);
    builder.equation(Kind::PointOnLine, 0.0, &[p[0], p[1], o[0], o[1], tilted[0], tilted[1]]);
    builder.equation(Kind::PointOnLine, 0.0, &[q[0], q[1], o[0], o[1], tilted[0], tilted[1]]);
    builder.equation(Kind::Difference, 0.0, &[p[0], q[0]]);
    builder.equation(Kind::Difference, 1.0, &[p[1], q[1]]);
    assert_eq!(diagnose(&builder), (Diagnosis::Diagnosed, None, vec![0, CONFLICTING, CONFLICTING, CONFLICTING, CONFLICTING]));
}

#[test]
fn a_long_closed_chain_around_a_shared_value_is_diagnosed_within_a_sparse_fill() {
    // 3,200 midpoints chained around a loop at a free shared value and closed by `x0 = x3200`:
    // the closure repeats them. Every midpoint shares that value's column, so least squares on
    // the rows themselves fills quadratically; the witness must come from the solve's own sparse
    // factor instead.
    let mut builder = Builder::new();
    let c = builder.parameter(1.0, false);
    let x: Vec<usize> = (0..=3200).map(|i| builder.parameter(if i % 2 == 0 { 1.5 } else { 0.5 }, false)).collect();
    for i in 0..3200 { builder.equation(Kind::Midpoint, 0.0, &[x[i], x[i + 1], c]); }
    builder.equation(Kind::Difference, 0.0, &[x[0], x[3200]]);
    let (outcome, _) = builder.outcome_within(Limits { fill: 20_000, ..sketch_solver::newton::LIMITS });
    assert_eq!(outcome.diagnosis, Diagnosis::Diagnosed);
    assert_eq!(outcome.labels.last(), Some(&REDUNDANT));
}

#[test]
fn a_weak_direction_hidden_from_the_pivot_columns_is_still_found() {
    // Singular values about 1.732, 1.2e-7 and 1e-8: rank is unclear. An inverse iteration from a
    // fixed start nearly misses the weakest direction here and would call it clear.
    let rows: Vec<Row> = [[1e-8, -8.616690359875787e-9, 8.03774303312371e-9, 1.0], [1e-8, 8.616690359875787e-9, -8.844220160038482e-8, 1.0], [1e-8, 0.0, 8.04044585672611e-8, 1.0]]
        .iter().map(|row| Row { entries: row.iter().copied().enumerate().filter(|e| e.1 != 0.0).collect(), residual: 0.0, tolerance: 1e-10 }).collect();
    let (found, _) = sketch_solver::diagnose::diagnose(4, &rows, TAU, 1_000_000, 1_000);
    let found = found.expect("diagnosed");
    assert_eq!((found.rank, found.witnesses.len(), found.certain), (3, 0, false));
}

#[test]
fn rows_clear_beyond_their_pivot_columns_are_checked_within_the_fill_limit() {
    // Row i is 1e-8 in x_i, 1 in y_i and 0.1 in a shared z: each lead is tiny, so the pivot columns
    // look nearly singular, but the rows are well conditioned. The shared z fills their transposed
    // factor densely, so a fill limit below it leaves rank unclear.
    let m = 30;
    let rows: Vec<Vec<(usize, f64)>> = (0..m).map(|i| vec![(i, 1e-8), (m + i, 1.0), (2 * m, 0.1)]).collect();
    let (clear, spent) = dependent(2 * m + 1, &rows, 100_000_000, usize::MAX);
    assert_eq!(clear, Some(Vec::new()));
    // The dense singular values take most of it, about 41 million entries for 30 rows.
    assert!(spent < 60_000_000, "{spent}");
    assert_eq!(dependent(2 * m + 1, &rows, 100_000_000, 100).0, None);
}