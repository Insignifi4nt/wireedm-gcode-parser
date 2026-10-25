mod common;

use common::Builder;
use sketch_solver::diagnose::{CONFLICTING, REDUNDANT};
use sketch_solver::equations::Kind;
use sketch_solver::newton::Limits;
use sketch_solver::problem::Diagnosis;

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
fn relations_without_unknowns_are_redundant_when_satisfied_and_conflict_otherwise() {
    for (value, label, dof) in [(5.0, REDUNDANT, Some(2)), (4.0, CONFLICTING, None)] {
        let mut builder = Builder::new();
        let a = builder.point(0.0, 0.0, true);
        let b = builder.point(3.0, 4.0, true);
        builder.equation(Kind::Distance, value, &[a[0], a[1], b[0], b[1]]);
        assert_eq!(diagnose(&builder), (Diagnosis::NoUnknowns, None, vec![0]));
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
