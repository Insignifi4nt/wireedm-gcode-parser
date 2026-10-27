mod common;

use common::Builder;
use sketch_solver::equations::Kind;
use sketch_solver::newton::{DragOutcome, Limits, Outcome};
use sketch_solver::problem::{Diagnosis, Status};
use sketch_solver::solve_buffer;

/// A point held `radius` from a fixed centre, started at `start` and dragged toward `target`.
fn circle(centre: [f64; 2], radius: f64, start: [f64; 2], target: [f64; 2]) -> (Outcome, [f64; 2]) {
    let mut builder = Builder::new();
    let c = builder.point(centre[0], centre[1], true);
    let p = builder.point(start[0], start[1], false);
    builder.equation(Kind::Distance, radius, &[c[0], c[1], p[0], p[1]]);
    builder.temporary(Kind::Value, target[0], &[p[0]]);
    builder.temporary(Kind::Value, target[1], &[p[1]]);
    let (outcome, values) = builder.outcome();
    (outcome, [values[p[0]], values[p[1]]])
}

fn near(a: [f64; 2], b: [f64; 2], tolerance: f64) -> bool { (a[0] - b[0]).hypot(a[1] - b[1]) <= tolerance }

#[test]
fn a_free_point_lands_exactly_on_its_target() {
    let mut builder = Builder::new();
    let p = builder.point(1.0, 2.0, false);
    builder.temporary(Kind::Value, 7.3, &[p[0]]);
    builder.temporary(Kind::Value, -2.1, &[p[1]]);
    let (outcome, values) = builder.outcome();
    assert_eq!((values[p[0]], values[p[1]]), (7.3, -2.1));
    assert_eq!((outcome.status, outcome.drag, outcome.target_distance), (Status::Converged, Some(DragOutcome::Reached), 0.0));
    assert_eq!((outcome.diagnosis, outcome.degrees_of_freedom), (Diagnosis::Diagnosed, Some(2)));
}

#[test]
fn a_landed_drag_leaves_the_rest_of_its_group_polished() {
    // Landing writes the target exactly; the point held 30 and 20 mm away follows to roundoff.
    let mut builder = Builder::new();
    let a = builder.point(5.0, 7.0, false);
    let b = builder.point(35.0, 27.0, false);
    builder.equation(Kind::Difference, 30.0, &[a[0], b[0]]);
    builder.equation(Kind::Difference, 20.0, &[a[1], b[1]]);
    builder.temporary(Kind::Value, 10.0, &[a[0]]);
    builder.temporary(Kind::Value, 20.0, &[a[1]]);
    let (outcome, values) = builder.outcome();
    assert_eq!((values[a[0]], values[a[1]]), (10.0, 20.0));
    assert!(near([values[b[0]], values[b[1]]], [40.0, 40.0], 1e-13), "{:?}", &values[b[0]..]);
    assert_eq!((outcome.status, outcome.drag, outcome.target_distance), (Status::Converged, Some(DragOutcome::Reached), 0.0));
}

#[test]
fn a_point_on_a_circle_goes_to_the_nearest_point_to_far_targets() {
    for distance in [15.0, 100.0, 1e6] {
        let direction = [0.3f64.cos(), 0.3f64.sin()];
        let (outcome, p) = circle([0.0, 0.0], 10.0, [10.0, 0.0], [distance * direction[0], distance * direction[1]]);
        assert!(near(p, [10.0 * direction[0], 10.0 * direction[1]], 1e-9), "{distance}: {p:?}");
        assert_eq!((outcome.status, outcome.drag), (Status::Converged, Some(DragOutcome::Projected)), "{distance}");
        assert!((outcome.target_distance - (distance - 10.0)).abs() <= 1e-9 * distance, "{distance}: {}", outcome.target_distance);
        // Targets are never diagnosed: the point keeps its one freedom.
        assert_eq!((outcome.degrees_of_freedom, outcome.labels), (Some(1), vec![0, 0, 0]));
    }
}

#[test]
fn a_dragged_point_leaves_the_far_side_of_its_circle() {
    // Exactly opposite the target the distance is stationary but largest; its negative curvature leaves it.
    let (outcome, p) = circle([0.0, 0.0], 10.0, [-10.0, 0.0], [20.0, 0.0]);
    assert!(near(p, [10.0, 0.0], 1e-9), "{p:?}");
    assert_eq!(outcome.drag, Some(DragOutcome::Projected));
}

#[test]
fn a_target_at_the_centre_keeps_the_point_on_its_circle() {
    // Every point of the circle is equally near: flat, and no step finds a closer one.
    let (outcome, p) = circle([0.0, 0.0], 10.0, [6.0, 8.0], [0.0, 0.0]);
    assert!((p[0].hypot(p[1]) - 10.0).abs() <= 1e-10, "{p:?}");
    assert_eq!((outcome.status, outcome.drag), (Status::Converged, Some(DragOutcome::Projected)));
    assert!((outcome.target_distance - 10.0).abs() <= 1e-10);
}

#[test]
fn circle_drags_do_not_depend_on_position_or_scale() {
    for (offset, scale) in [(1e6, 1.0), (-3e8, 1.0), (0.0, 1e-3), (0.0, 1e3), (5e5, 1e-2)] {
        let at = |x: f64, y: f64| [offset + scale * x, offset + scale * y];
        let (outcome, p) = circle(at(0.0, 0.0), 10.0 * scale, at(10.0, 0.0), at(0.0, 30.0));
        assert!(near(p, at(0.0, 10.0), 1e-9 * scale.max(1.0) + 64.0 * f64::EPSILON * offset.abs()), "{offset} {scale}: {p:?}");
        assert_eq!(outcome.drag, Some(DragOutcome::Projected), "{offset} {scale}");
    }
}

#[test]
fn a_point_on_a_line_goes_to_the_foot_of_its_target() {
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let b = builder.point(1.0, 5.0, true);
    let p = builder.point(0.2, 1.0, false);
    builder.equation(Kind::PointOnLine, 0.0, &[p[0], p[1], a[0], a[1], b[0], b[1]]);
    builder.temporary(Kind::Value, 7.0, &[p[0]]);
    builder.temporary(Kind::Value, 1.0, &[p[1]]);
    let (outcome, values) = builder.outcome();
    assert!(near([values[p[0]], values[p[1]]], [12.0 / 26.0, 60.0 / 26.0], 1e-10), "{:?}", &values[p[0]..]);
    assert_eq!(outcome.drag, Some(DragOutcome::Projected));
}

#[test]
fn a_far_target_beside_a_linear_relation_projects_in_one_line() {
    // x = 0 holds the point; a target 1e9 away still moves it to y = 1 exactly, and its pull across
    // x = 0 leaves only a residue far below any row's roundoff.
    let mut builder = Builder::new();
    let p = builder.point(0.0, 0.0, false);
    builder.equation(Kind::Value, 0.0, &[p[0]]);
    builder.temporary(Kind::Value, 1e9, &[p[0]]);
    builder.temporary(Kind::Value, 1.0, &[p[1]]);
    let (outcome, values) = builder.outcome();
    assert!(values[p[0]].abs() <= 1e-30 && values[p[1]] == 1.0, "{:?}", &values[p[0]..]);
    assert_eq!((outcome.status, outcome.drag, outcome.target_distance), (Status::Converged, Some(DragOutcome::Projected), 1e9));
}

#[test]
fn a_far_target_beside_a_short_guide_still_projects() {
    // A 10 mm guide bounds each step, and a target 1e9 away along the normal must not pin the
    // point to the guide's scale: it reaches the foot of the target.
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let b = builder.point(0.0, 10.0, true);
    let p = builder.point(0.0, 2.0, false);
    builder.equation(Kind::PointOnLine, 0.0, &[p[0], p[1], a[0], a[1], b[0], b[1]]);
    builder.temporary(Kind::Value, 1e9, &[p[0]]);
    builder.temporary(Kind::Value, 1000.0, &[p[1]]);
    let (outcome, values) = builder.outcome();
    assert!(near([values[p[0]], values[p[1]]], [0.0, 1000.0], 1e-6), "{:?}", &values[p[0]..]);
    assert_eq!(outcome.drag, Some(DragOutcome::Projected));
}

#[test]
fn fixed_and_held_coordinates_count_toward_the_distance_but_stay() {
    // x held by a relation, in its own group from the free y.
    let mut builder = Builder::new();
    let p = builder.point(3.0, 0.0, false);
    builder.equation(Kind::Value, 3.0, &[p[0]]);
    builder.temporary(Kind::Value, 8.0, &[p[0]]);
    builder.temporary(Kind::Value, 4.0, &[p[1]]);
    let (outcome, values) = builder.outcome();
    assert_eq!((values[p[0]], values[p[1]]), (3.0, 4.0));
    assert_eq!((outcome.drag, outcome.target_distance), (Some(DragOutcome::Projected), 5.0));
    // An expression-fixed x is never moved; y still is.
    let mut builder = Builder::new();
    let x = builder.parameter(3.0, true);
    let y = builder.parameter(0.0, false);
    builder.temporary(Kind::Value, 8.0, &[x]);
    builder.temporary(Kind::Value, 4.0, &[y]);
    let (outcome, values) = builder.outcome();
    assert_eq!((values[x], values[y]), (3.0, 4.0));
    assert_eq!((outcome.status, outcome.drag, outcome.target_distance), (Status::Converged, Some(DragOutcome::Projected), 5.0));
    // With both fixed nothing moves, and a met target is reached.
    for (target, drag, distance) in [([3.0, 0.0], DragOutcome::Reached, 0.0), ([0.0, 4.0], DragOutcome::Projected, 5.0)] {
        let mut builder = Builder::new();
        let p = builder.point(3.0, 0.0, true);
        builder.temporary(Kind::Value, target[0], &[p[0]]);
        builder.temporary(Kind::Value, target[1], &[p[1]]);
        let (outcome, _) = builder.outcome();
        assert_eq!((outcome.diagnosis, outcome.drag, outcome.target_distance), (Diagnosis::NoUnknowns, Some(drag), distance));
    }
}

#[test]
fn groups_without_targets_keep_their_exact_values() {
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    // Accepted but not at roundoff: a solve without targets would polish it.
    let b = builder.point(3.0 + 1e-12, 4.0, false);
    builder.equation(Kind::Distance, 5.0, &[a[0], a[1], b[0], b[1]]);
    let p = builder.point(1.0, 1.0, false);
    builder.temporary(Kind::Value, 2.0, &[p[0]]);
    builder.temporary(Kind::Value, 2.0, &[p[1]]);
    let (outcome, values) = builder.outcome();
    assert_eq!((values[b[0]], values[b[1]]), (3.0 + 1e-12, 4.0));
    assert_eq!((outcome.drag, outcome.degrees_of_freedom), (Some(DragOutcome::Reached), Some(3)));
}

#[test]
fn an_elbow_keeps_its_side() {
    // Two 10 mm links from a fixed base; the tip is dragged within reach and the elbow stays up.
    let mut builder = Builder::new();
    let base = builder.point(0.0, 0.0, true);
    let joint = builder.point(0.0, 10.0, false);
    let tip = builder.point(10.0, 10.0, false);
    builder.equation(Kind::Distance, 10.0, &[base[0], base[1], joint[0], joint[1]]);
    builder.equation(Kind::Distance, 10.0, &[joint[0], joint[1], tip[0], tip[1]]);
    builder.temporary(Kind::Value, 15.0, &[tip[0]]);
    builder.temporary(Kind::Value, -3.0, &[tip[1]]);
    let (outcome, values) = builder.outcome();
    assert_eq!((values[tip[0]], values[tip[1]]), (15.0, -3.0));
    assert_eq!(outcome.drag, Some(DragOutcome::Reached));
    let side = values[tip[0]] * values[joint[1]] - values[tip[1]] * values[joint[0]];
    assert!(side > 0.0, "the elbow turned over: {:?}", &values[joint[0]..]);
}

/// Two 10 mm links from a fixed base at the origin, joint and tip started at `joint` and `tip`,
/// with the tip dragged toward `target`.
fn arm(joint: [f64; 2], tip: [f64; 2], target: [f64; 2]) -> (Outcome, [f64; 2], [f64; 2]) {
    let mut builder = Builder::new();
    let b = builder.point(0.0, 0.0, true);
    let j = builder.point(joint[0], joint[1], false);
    let t = builder.point(tip[0], tip[1], false);
    builder.equation(Kind::Distance, 10.0, &[b[0], b[1], j[0], j[1]]);
    builder.equation(Kind::Distance, 10.0, &[j[0], j[1], t[0], t[1]]);
    builder.temporary(Kind::Value, target[0], &[t[0]]);
    builder.temporary(Kind::Value, target[1], &[t[1]]);
    let (outcome, values) = builder.outcome();
    (outcome, [values[j[0]], values[j[1]]], [values[t[0]], values[t[1]]])
}

#[test]
fn a_straight_arm_folds_toward_a_target_inside_its_reach() {
    // Straight, the tip cannot move toward the base to first order: only folding the elbow, which
    // keeps the tip still to first order, gets it closer.
    let (outcome, _, tip) = arm([10.0, 0.0], [20.0, 0.0], [15.0, 0.0]);
    assert_eq!(tip, [15.0, 0.0]);
    assert_eq!((outcome.status, outcome.drag), (Status::Converged, Some(DragOutcome::Reached)));
}

#[test]
fn a_stretched_arm_stays_projected_beyond_its_reach() {
    // Folding takes the tip away from a target beyond its reach, so the straight arm is nearest.
    let (outcome, joint, tip) = arm([10.0, 0.0], [20.0, 0.0], [25.0, 0.0]);
    assert!(near(joint, [10.0, 0.0], 1e-9) && near(tip, [20.0, 0.0], 1e-9), "{joint:?} {tip:?}");
    assert_eq!((outcome.status, outcome.drag), (Status::Converged, Some(DragOutcome::Projected)));
}

#[test]
fn a_tiny_circle_leaves_its_far_side_for_a_target_a_billion_times_further() {
    let (outcome, p) = circle([0.0, 0.0], 0.001, [-0.001, 0.0], [1e9, 0.0]);
    assert!(near(p, [0.001, 0.0], 1e-12), "{p:?}");
    assert_eq!(outcome.drag, Some(DragOutcome::Projected));
}

#[test]
fn a_drag_leaves_a_farthest_point_within_one_iteration_budget() {
    // From the farthest point half way round to the nearest. Stationarity is certified on the
    // gradient, which grows only 0.1 mm per mm along the circle there, so the point is within 1e-8.
    let (outcome, p) = circle([0.0, 0.0], 10.0, [10.0, 0.0], [-1.0, 0.0]);
    assert!(near(p, [-10.0, 0.0], 1e-8), "{p:?}");
    assert_eq!(outcome.drag, Some(DragOutcome::Projected));
    assert!(outcome.iterations <= sketch_solver::newton::DRAG_ITERATIONS / 2, "{}", outcome.iterations);
}

#[test]
fn an_infeasible_start_that_cannot_be_restored_stalls() {
    // Distances 3 and 4 from one fixed point cannot both hold.
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let p = builder.point(3.0, 0.0, false);
    builder.equation(Kind::Distance, 3.0, &[a[0], a[1], p[0], p[1]]);
    builder.equation(Kind::Distance, 4.0, &[a[0], a[1], p[0], p[1]]);
    builder.temporary(Kind::Value, 5.0, &[p[0]]);
    builder.temporary(Kind::Value, 5.0, &[p[1]]);
    let (outcome, _) = builder.outcome();
    assert_eq!((outcome.status, outcome.drag), (Status::NotConverged, Some(DragOutcome::Stalled)));
}

#[test]
fn a_drag_that_runs_out_of_work_is_too_large_and_feasible() {
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let p = builder.point(10.0, 0.0, false);
    builder.equation(Kind::Distance, 10.0, &[a[0], a[1], p[0], p[1]]);
    builder.temporary(Kind::Value, -5.0, &[p[0]]);
    builder.temporary(Kind::Value, 30.0, &[p[1]]);
    let (outcome, values) = builder.outcome_within(Limits { fill: usize::MAX, work: 200 });
    assert_eq!((outcome.status, outcome.drag, outcome.diagnosis), (Status::TooLarge, Some(DragOutcome::Stalled), Diagnosis::Unavailable));
    assert!((values[p[0]].hypot(values[p[1]]) - 10.0).abs() <= 1e-10);
}

#[test]
fn the_same_drag_gives_the_same_bits() {
    let mut builder = Builder::new();
    let base = builder.point(0.0, 0.0, true);
    let joint = builder.point(0.0, 10.0, false);
    let tip = builder.point(10.0, 10.0, false);
    builder.equation(Kind::Distance, 10.0, &[base[0], base[1], joint[0], joint[1]]);
    builder.equation(Kind::Distance, 10.0, &[joint[0], joint[1], tip[0], tip[1]]);
    builder.temporary(Kind::Value, 40.0, &[tip[0]]);
    builder.temporary(Kind::Value, 7.0, &[tip[1]]);
    let (first, second) = (solve_buffer(&builder.encode()), solve_buffer(&builder.encode()));
    assert!(first.len() == second.len() && first.iter().zip(&second).all(|(a, b)| a.to_bits() == b.to_bits()));
    // Out of reach: the arm stretches toward the target.
    assert_eq!(first[7], DragOutcome::Projected as u8 as f64);
}

#[test]
fn only_value_rows_can_be_targets() {
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, false);
    let b = builder.point(1.0, 0.0, false);
    builder.temporary(Kind::Distance, 2.0, &[a[0], a[1], b[0], b[1]]);
    assert_eq!(solve_buffer(&builder.encode())[2], Status::InvalidInput as u8 as f64);
}

/// A chain of links from a fixed base through `joints` to its tip, each as long as it starts,
/// with the tip dragged toward `target`.
fn chain(base: [f64; 2], joints: &[[f64; 2]], target: [f64; 2]) -> (Outcome, [f64; 2]) {
    let mut builder = Builder::new();
    let mut previous = (builder.point(base[0], base[1], true), base);
    for &joint in joints {
        let point = builder.point(joint[0], joint[1], false);
        builder.equation(Kind::Distance, (joint[0] - previous.1[0]).hypot(joint[1] - previous.1[1]), &[previous.0[0], previous.0[1], point[0], point[1]]);
        previous = (point, joint);
    }
    let tip = previous.0;
    builder.temporary(Kind::Value, target[0], &[tip[0]]);
    builder.temporary(Kind::Value, target[1], &[tip[1]]);
    let (outcome, values) = builder.outcome();
    (outcome, [values[tip[0]], values[tip[1]]])
}

#[test]
fn a_straight_arm_folds_whatever_its_direction() {
    let (outcome, tip) = chain([0.0, 0.0], &[[1.0, -0.7], [2.0, -1.4]], [1.5, -1.05]);
    assert_eq!((tip, outcome.drag), ([1.5, -1.05], Some(DragOutcome::Reached)));
}

#[test]
fn a_folded_back_chain_unfolds_toward_a_target_inside_its_reach() {
    let (outcome, tip) = chain([0.0, 0.0], &[[10.0, 0.0], [20.0, 0.0], [10.0, 0.0]], [5.0, 0.0]);
    assert_eq!((tip, outcome.drag), ([5.0, 0.0], Some(DragOutcome::Reached)));
}

#[test]
fn a_tiny_circle_far_from_the_origin_leaves_its_far_side() {
    let (outcome, p) = circle([-3e8, 0.0], 0.001, [-3e8 - 0.001, 0.0], [-3e8 + 0.002, 0.0]);
    assert!(near(p, [-3e8 + 0.001, 0.0], 1e-7), "{p:?}");
    assert_eq!(outcome.drag, Some(DragOutcome::Projected));
}

#[test]
fn a_far_drag_never_passes_its_iteration_budget() {
    let (outcome, _) = chain([0.0, 0.0], &[[0.0, 10.0], [10.0, 10.0]], [600.0, -900.0]);
    assert!(outcome.iterations <= sketch_solver::newton::DRAG_ITERATIONS, "{}", outcome.iterations);
}

#[test]
fn a_point_on_a_turning_line_is_not_held_by_its_start() {
    // The point sits on a line through the fixed origin and (1, u) with u free. Sliding along the
    // line or turning it alone gains nothing, but doing both at once does: (s, s^2) on u = s.
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let bx = builder.parameter(1.0, true);
    let by = builder.parameter(0.0, false);
    let p = builder.point(0.0, 0.0, false);
    builder.equation(Kind::PointOnLine, 0.0, &[p[0], p[1], a[0], a[1], bx, by]);
    builder.temporary(Kind::Value, 0.0, &[p[0]]);
    builder.temporary(Kind::Value, 1.0, &[p[1]]);
    let (outcome, _) = builder.outcome();
    assert!(outcome.target_distance < 0.5, "{outcome:?}");
}

#[test]
fn a_stretched_chain_is_certified_up_to_the_curvature_support() {
    // Every link of a chain stretched toward a target beyond its reach carries tension, so the
    // curvature test spans all its joints: 30 are certified, 40 are past its support.
    for (joints, outcome) in [(30, DragOutcome::Projected), (40, DragOutcome::Stalled)] {
        let points: Vec<[f64; 2]> = (1..=joints).map(|k| [k as f64, 0.0]).collect();
        let (result, tip) = chain([0.0, 0.0], &points, [joints as f64 + 5.0, 0.0]);
        assert!(near(tip, [joints as f64, 0.0], 1e-9), "{joints} {tip:?}");
        assert_eq!((result.status, result.drag), (Status::Converged, Some(outcome)), "{joints}");
    }
}

#[test]
fn a_repeated_relation_still_certifies_its_nearest_point() {
    // Two equal distance rows share one multiplier between them.
    let mut builder = Builder::new();
    let c = builder.point(0.0, 0.0, true);
    let p = builder.point(0.0, 10.0, false);
    builder.equation(Kind::Distance, 10.0, &[c[0], c[1], p[0], p[1]]);
    builder.equation(Kind::Distance, 10.0, &[c[0], c[1], p[0], p[1]]);
    builder.temporary(Kind::Value, 30.0, &[p[0]]);
    builder.temporary(Kind::Value, 40.0, &[p[1]]);
    let (outcome, values) = builder.outcome();
    assert!(near([values[p[0]], values[p[1]]], [6.0, 8.0], 1e-9), "{:?}", &values[p[0]..]);
    assert_eq!(outcome.drag, Some(DragOutcome::Projected));
}

#[test]
fn a_flat_point_whose_distance_falls_at_fourth_order_is_left() {
    // x^2 + u^2 = 1 and y = 2u: from (1, 0) toward (-3, 0) the squared distance along the circle
    // is 16 - 3 (1 - cos t)^2, flat to second order but falling.
    let mut builder = Builder::new();
    let o = builder.point(0.0, 0.0, true);
    let x = builder.parameter(1.0, false);
    let u = builder.parameter(0.0, false);
    let y = builder.parameter(0.0, false);
    builder.equation(Kind::Distance, 1.0, &[o[0], o[1], x, u]);
    builder.equation(Kind::Midpoint, 0.0, &[o[1], y, u]);
    builder.temporary(Kind::Value, -3.0, &[x]);
    builder.temporary(Kind::Value, 0.0, &[y]);
    let (outcome, _) = builder.outcome();
    assert!(outcome.target_distance < 3.9, "{outcome:?}");
}

#[test]
fn a_collapsed_distance_is_not_certified() {
    // |B - O| = r with B on O and r = 0, and P.x = r: B leaving O lets P reach its target, though
    // the zero distance has no gradient to show it.
    let mut builder = Builder::new();
    let o = builder.point(0.0, 0.0, true);
    let b = builder.point(0.0, 0.0, false);
    let r = builder.parameter(0.0, false);
    let px = builder.parameter(0.0, false);
    let py = builder.parameter(0.0, true);
    builder.equation(Kind::DistanceToParameter, 0.0, &[o[0], o[1], b[0], b[1], r]);
    builder.equation(Kind::Difference, 0.0, &[r, px]);
    builder.temporary(Kind::Value, 1.0, &[px]);
    builder.temporary(Kind::Value, 0.0, &[py]);
    let (outcome, _) = builder.outcome();
    assert_ne!(outcome.drag, Some(DragOutcome::Projected), "{outcome:?}");
}

#[test]
fn a_slight_negative_curvature_is_followed() {
    // A target just past the centre of a 1000 mm circle: the start is farthest by 2 um.
    let (outcome, p) = circle([0.0, 0.0], 1000.0, [1000.0, 0.0], [-0.001, 0.0]);
    // The nearest point curves only 1e-6 per mm, so its distance is resolved before its place.
    assert!(near(p, [-1000.0, 0.0], 1e-3) && (outcome.target_distance - 999.999).abs() <= 1e-9, "{p:?} {}", outcome.target_distance);
    assert_eq!(outcome.drag, Some(DragOutcome::Projected));
}

#[test]
fn a_radius_between_fixed_points_is_a_linear_row() {
    // |O - O| = r with both points fixed is -r = 0, so x = r holds the target's coordinate.
    let mut builder = Builder::new();
    let o = builder.point(0.0, 0.0, true);
    let q = builder.point(0.0, 0.0, true);
    let r = builder.parameter(0.0, false);
    let x = builder.parameter(0.0, false);
    builder.equation(Kind::DistanceToParameter, 0.0, &[o[0], o[1], q[0], q[1], r]);
    builder.equation(Kind::Difference, 0.0, &[r, x]);
    builder.temporary(Kind::Value, 1.0, &[x]);
    let (outcome, values) = builder.outcome();
    assert!(values[r].abs() <= 1e-30 && values[x].abs() <= 1e-30, "{} {}", values[r], values[x]);
    assert_eq!((outcome.status, outcome.drag), (Status::Converged, Some(DragOutcome::Projected)));
}

#[test]
fn a_landing_polish_out_of_work_leaves_the_landing_as_it_was() {
    // Every row is accepted at the start and the target is where P already is; the polish runs
    // out of work part way and must not leave Q moved off its accepted place.
    let mut builder = Builder::new();
    let p = builder.point(0.0, 0.0, false);
    let q = builder.point(1e-5, 1.0, false);
    let c = builder.point(0.0, 2.0, true);
    builder.equation(Kind::Distance, 1.0, &[p[0], p[1], q[0], q[1]]);
    builder.equation(Kind::Distance, 1.0, &[c[0], c[1], q[0], q[1]]);
    builder.equation(Kind::Distance, 1.0 + 1.2e-10, &[p[0], p[1], q[0], q[1]]);
    builder.temporary(Kind::Value, 0.0, &[p[0]]);
    builder.temporary(Kind::Value, 0.0, &[p[1]]);
    // A polish can end accepted although its work ran out; that is cut short too.
    let (_, polished) = builder.outcome();
    for work in 150..1000 {
        let (outcome, values) = builder.outcome_within(Limits { fill: 1_000_000, work });
        let expected = if outcome.status == Status::TooLarge { [1e-5, 1.0] } else { [polished[q[0]], polished[q[1]]] };
        assert_eq!([values[q[0]], values[q[1]]], expected, "work {work}");
    }
}

#[test]
fn a_collapsed_distance_beside_a_large_multiplier_is_not_certified() {
    // A far target on Q, held by two unit circles, makes every other multiplier small beside its
    // own; the collapsed |B| = r still may open and let x reach its target.
    let mut builder = Builder::new();
    let o = builder.point(0.0, 0.0, true);
    let b = builder.point(0.0, 0.0, false);
    let q = builder.point(0.0, 0.0, false);
    let r = builder.parameter(0.0, false);
    let x = builder.parameter(0.0, false);
    let first = builder.point(-1.0, 0.0, true);
    let second = builder.point(-(0.0005f64).cos(), -(0.0005f64).sin(), true);
    builder.equation(Kind::DistanceToParameter, 0.0, &[o[0], o[1], b[0], b[1], r]);
    builder.equation(Kind::Difference, 0.0, &[r, x]);
    builder.equation(Kind::Difference, 0.0, &[b[1], q[0]]);
    builder.equation(Kind::Distance, 1.0, &[first[0], first[1], q[0], q[1]]);
    builder.equation(Kind::Distance, 1.0, &[second[0], second[1], q[0], q[1]]);
    builder.temporary(Kind::Value, 0.01, &[x]);
    builder.temporary(Kind::Value, 1e9, &[q[1]]);
    let (outcome, _) = builder.outcome();
    assert_ne!(outcome.drag, Some(DragOutcome::Projected), "{outcome:?}");
}

#[test]
fn a_far_side_point_with_a_long_doubling_chain_still_leaves() {
    // (x, u) on a unit circle at its far side from x = 3, with v1 = 2u, v2 = 2 v1, ... v18 = 2 v17:
    // the null direction barely moves the point, so its projector weight on the support is about
    // 4^-18, below any fixed cutoff, yet the point can still leave. Each step moves v18 2^18 times
    // as far as the point, so it may run out of work on the way, but never certifies short of x = 1.
    let mut builder = Builder::new();
    let o = builder.point(0.0, 0.0, true);
    let x = builder.parameter(-1.0, false);
    let u = builder.parameter(0.0, false);
    builder.equation(Kind::Distance, 1.0, &[o[0], o[1], x, u]);
    let mut previous = u;
    for _ in 0..18 {
        let next = builder.parameter(0.0, false);
        builder.equation(Kind::Midpoint, 0.0, &[o[1], next, previous]);
        previous = next;
    }
    builder.temporary(Kind::Value, 3.0, &[x]);
    let (outcome, values) = builder.outcome();
    assert!(values[x] > -0.99, "{outcome:?} {}", values[x]);
    assert!(values[x] > 0.999 || outcome.drag == Some(DragOutcome::Stalled), "{outcome:?} {}", values[x]);
    assert_eq!(outcome.status, Status::Converged);
}

#[test]
fn a_far_side_point_geared_twenty_times_is_not_certified() {
    // As above with 20 doublings: the point's share of the null direction, 2^-40, is the size of
    // the leak a damped projector passes along held directions.
    let mut builder = Builder::new();
    let o = builder.point(0.0, 0.0, true);
    let x = builder.parameter(-1.0, false);
    let u = builder.parameter(0.0, false);
    builder.equation(Kind::Distance, 1.0, &[o[0], o[1], x, u]);
    let mut previous = u;
    for _ in 0..20 {
        let next = builder.parameter(0.0, false);
        builder.equation(Kind::Midpoint, 0.0, &[o[1], next, previous]);
        previous = next;
    }
    builder.temporary(Kind::Value, 3.0, &[x]);
    let (outcome, values) = builder.outcome();
    assert!(values[x] > 0.999 || outcome.drag == Some(DragOutcome::Stalled), "{outcome:?} {}", values[x]);
}

#[test]
fn weak_multipliers_beside_large_unrelated_ones_are_not_certified() {
    // x^2 + y^2 = 1, |(x, z)| = r and r on a guide of slope 2e-7: the circle's multiplier is
    // weakly determined. A point held by two fixed guides 0.001 apart and dragged 1e9 away, tied
    // in by a midpoint, carries multipliers near 1e12; their roundoff must not pass for the
    // circle multiplier's error, which hides a negative curvature along y.
    let mut builder = Builder::new();
    let o = builder.point(0.0, 0.0, true);
    let x = builder.parameter(1.0, false);
    let y = builder.parameter(0.0, false);
    let z = builder.parameter(0.0, false);
    let r = builder.parameter(1.0, false);
    let a = builder.point(1.0, 0.0, true);
    let c = builder.point(1.0 + 2e-7, 1.0, true);
    builder.equation(Kind::Distance, 1.0, &[o[0], o[1], x, y]);
    builder.equation(Kind::DistanceToParameter, 0.0, &[o[0], o[1], x, z, r]);
    builder.equation(Kind::PointOnLine, 0.0, &[r, z, a[0], a[1], c[0], c[1]]);
    let q = builder.point(0.0, 0.0, false);
    let g = builder.point(1.0, 0.0, true);
    let h = builder.point(1.0, 0.001, true);
    builder.equation(Kind::PointOnLine, 0.0, &[q[0], q[1], o[0], o[1], g[0], g[1]]);
    builder.equation(Kind::PointOnLine, 0.0, &[q[0], q[1], o[0], o[1], h[0], h[1]]);
    let middle = builder.parameter(0.5, false);
    builder.equation(Kind::Midpoint, 0.0, &[q[1], x, middle]);
    builder.temporary(Kind::Value, -0.3, &[x]);
    builder.temporary(Kind::Value, 0.0, &[y]);
    builder.temporary(Kind::Value, 0.0, &[z]);
    builder.temporary(Kind::Value, 1e9, &[q[0]]);
    let (outcome, values) = builder.outcome();
    assert!(outcome.drag != Some(DragOutcome::Projected) || values[y].abs() > 1e-3, "{outcome:?} {values:?}");
}

#[test]
fn a_small_multiplier_geared_far_still_bends_the_drag() {
    // (x, u) on a unit circle dragged to x = 2, u geared by 10 doublings into a circle of 1e6 mm
    // whose far point is dragged 1 mm in. That circle bends only 1e-6 per mm, yet through the
    // gearing it bends the path by about -0.05 per unit u, so u = 0 is not nearest and the drag
    // leaves it.
    let mut builder = Builder::new();
    let o = builder.point(0.0, 0.0, true);
    let x = builder.parameter(1.0, false);
    let u = builder.parameter(0.0, false);
    builder.equation(Kind::Distance, 1.0, &[o[0], o[1], x, u]);
    let mut previous = u;
    for _ in 0..10 {
        let next = builder.parameter(0.0, false);
        builder.equation(Kind::Midpoint, 0.0, &[o[1], next, previous]);
        previous = next;
    }
    let z = builder.parameter(1e6, false);
    builder.equation(Kind::Distance, 1e6, &[o[0], o[1], z, previous]);
    builder.temporary(Kind::Value, 2.0, &[x]);
    builder.temporary(Kind::Value, 1e6 - 1.0, &[z]);
    let (outcome, values) = builder.outcome();
    assert!(values[u].abs() > 0.1, "{outcome:?} {}", values[u]);
    assert!(outcome.target_distance < 2f64.sqrt() - 1e-4, "{outcome:?}");
    assert_eq!(outcome.status, Status::Converged);
}

#[test]
fn a_free_part_the_targets_do_not_reach_leaves_the_drag_projected() {
    // Line cd collinear with a fixed line at y = 7, d dragged to (40, 12): d stops at (40, 7). c
    // can still slide along the line at no cost, a flat direction no step improves.
    let mut builder = Builder::new();
    let a = builder.point(0.0, 7.0, true);
    let b = builder.point(10.0, 7.0, true);
    let c = builder.point(20.0, 7.0, false);
    let d = builder.point(30.0, 7.0, false);
    builder.equation(Kind::Parallel, 0.0, &[a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]]);
    builder.equation(Kind::PointOnLine, 0.0, &[c[0], c[1], a[0], a[1], b[0], b[1]]);
    builder.temporary(Kind::Value, 40.0, &[d[0]]);
    builder.temporary(Kind::Value, 12.0, &[d[1]]);
    let (outcome, values) = builder.outcome();
    assert_eq!((outcome.status, outcome.drag), (Status::Converged, Some(DragOutcome::Projected)));
    assert!((values[d[0]] - 40.0).abs() <= 1e-9 && (values[d[1]] - 7.0).abs() <= 1e-9, "{values:?}");
}

#[test]
fn a_flat_direction_moving_a_target_is_probed_beside_a_free_one() {
    // The fourth-order point beside the collinear line, tied by a midpoint of x and c: c's slide is
    // flat and moves no target, the circle's turn is flat and moves y. The circle's must be probed.
    let mut builder = Builder::new();
    let o = builder.point(0.0, 0.0, true);
    let x = builder.parameter(1.0, false);
    let u = builder.parameter(0.0, false);
    let y = builder.parameter(0.0, false);
    builder.equation(Kind::Distance, 1.0, &[o[0], o[1], x, u]);
    builder.equation(Kind::Midpoint, 0.0, &[o[1], y, u]);
    let a = builder.point(0.0, 7.0, true);
    let b = builder.point(10.0, 7.0, true);
    let c = builder.point(20.0, 7.0, false);
    let d = builder.point(40.0, 7.0, false);
    builder.equation(Kind::Parallel, 0.0, &[a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]]);
    builder.equation(Kind::PointOnLine, 0.0, &[c[0], c[1], a[0], a[1], b[0], b[1]]);
    let middle = builder.parameter(10.5, false);
    builder.equation(Kind::Midpoint, 0.0, &[x, c[0], middle]);
    builder.temporary(Kind::Value, -3.0, &[x]);
    builder.temporary(Kind::Value, 0.0, &[y]);
    builder.temporary(Kind::Value, 40.0, &[d[0]]);
    builder.temporary(Kind::Value, 12.0, &[d[1]]);
    let (outcome, _) = builder.outcome();
    assert!(outcome.drag != Some(DragOutcome::Projected) || outcome.target_distance < 41f64.sqrt() - 1e-3, "{outcome:?}");
}

#[test]
fn a_weak_multiplier_left_out_does_not_fake_a_negative_curvature() {
    // The unit circle's antipode with u geared 2^17 into a unit circle on z pulled 1e-9 out: that
    // circle's multiplier is too weak to count, yet through the gearing it bends the path by about
    // +17 per unit u against the antipode's -4, so the antipode is nearest after all.
    let mut builder = Builder::new();
    let o = builder.point(0.0, 0.0, true);
    let x = builder.parameter(-1.0, false);
    let u = builder.parameter(0.0, false);
    builder.equation(Kind::Distance, 1.0, &[o[0], o[1], x, u]);
    let mut previous = u;
    for _ in 0..17 {
        let next = builder.parameter(0.0, false);
        builder.equation(Kind::Midpoint, 0.0, &[o[1], next, previous]);
        previous = next;
    }
    let z = builder.parameter(1.0, false);
    builder.equation(Kind::Distance, 1.0, &[o[0], o[1], z, previous]);
    builder.temporary(Kind::Value, 3.0, &[x]);
    builder.temporary(Kind::Value, 1.0 + 1e-9, &[z]);
    let (outcome, values) = builder.outcome();
    assert_eq!((outcome.status, outcome.drag), (Status::Converged, Some(DragOutcome::Projected)));
    assert_eq!(values[x], -1.0);
}

#[test]
fn the_curvature_test_reports_running_out_of_work() {
    // A straight chain of 100 unit links dragged 1 mm past its reach: the curvature test's solves
    // alone exceed the work allowed, which is reported, not taken as a stall.
    let mut builder = Builder::new();
    let mut p = builder.point(0.0, 0.0, true);
    for k in 1..=100 {
        let q = builder.point(k as f64, 0.0, false);
        builder.equation(Kind::Distance, 1.0, &[p[0], p[1], q[0], q[1]]);
        p = q;
    }
    builder.temporary(Kind::Value, 101.0, &[p[0]]);
    builder.temporary(Kind::Value, 0.0, &[p[1]]);
    let (outcome, _) = builder.outcome_within(Limits { fill: 2_000_000, work: 30_000 });
    assert_eq!((outcome.status, outcome.drag), (Status::TooLarge, Some(DragOutcome::Stalled)));
}

#[test]
fn a_far_circle_geared_into_a_weak_one_is_not_taken_for_a_maximum() {
    // A unit circle centred at (1e8, 1e8), its point's y geared by 12 doublings into a unit circle
    // pulled just out: the two bends nearly cancel, leaving +1e-14, and the far centre's differencing
    // error is far larger, so no negative curvature may be claimed.
    let centre = 1e8;
    let mut builder = Builder::new();
    let c = builder.point(centre, centre, true);
    let a = std::f64::consts::FRAC_1_SQRT_2;
    let p = builder.point(centre + a, centre + a, false);
    let q = builder.values[p[0]] - centre;
    builder.equation(Kind::Distance, (2.0 * q * q).sqrt(), &[c[0], c[1], p[0], p[1]]);
    let mut previous = builder.parameter(0.0, false);
    builder.equation(Kind::Difference, -builder.values[p[1]], &[p[1], previous]);
    let zero = builder.parameter(0.0, true);
    for _ in 0..12 {
        let next = builder.parameter(0.0, false);
        builder.equation(Kind::Midpoint, 0.0, &[zero, next, previous]);
        previous = next;
    }
    let z = builder.parameter(1.0, false);
    builder.equation(Kind::Distance, 1.0, &[zero, zero, z, previous]);
    let target = centre - 3.0 * q;
    let beta = (builder.values[p[0]] - target) / q - 1.0;
    let pull = f64::from_bits((1.0 + 2.0 * beta * 2f64.powi(-24)).to_bits() + 64);
    builder.temporary(Kind::Value, target, &[p[0]]);
    builder.temporary(Kind::Value, target, &[p[1]]);
    builder.temporary(Kind::Value, pull, &[z]);
    let (outcome, _) = builder.outcome();
    assert_eq!((outcome.status, outcome.drag), (Status::Converged, Some(DragOutcome::Projected)));
}

#[test]
fn the_curvature_test_eigensolves_and_ordering_count_against_the_work() {
    // Eight unit circles tied by free midpoints, each point dragged out radially: the dense
    // eigensolves alone pass 100000 entries. And 100 repeated unit circles: ordering their
    // transposed Jacobian alone passes 5000.
    let mut builder = Builder::new();
    let o = builder.point(0.0, 0.0, true);
    let mut previous = None;
    for k in 0..8 {
        let angle = 0.1 + k as f64 * 0.4141414;
        let p = builder.point(angle.cos(), angle.sin(), false);
        builder.equation(Kind::Distance, 1.0, &[o[0], o[1], p[0], p[1]]);
        if let Some(q) = previous {
            let middle = builder.parameter(0.5 * (builder.values[q] + builder.values[p[0]]), false);
            builder.equation(Kind::Midpoint, 0.0, &[q, p[0], middle]);
        }
        previous = Some(p[0]);
        builder.temporary(Kind::Value, 2.0 * angle.cos(), &[p[0]]);
        builder.temporary(Kind::Value, 2.0 * angle.sin(), &[p[1]]);
    }
    let (outcome, _) = builder.outcome_within(Limits { fill: 2_000_000, work: 100_000 });
    assert_eq!((outcome.status, outcome.drag), (Status::TooLarge, Some(DragOutcome::Stalled)));
    let (outcome, _) = builder.outcome_within(Limits { fill: 2_000_000, work: 400_000_000 });
    assert_eq!((outcome.status, outcome.drag), (Status::Converged, Some(DragOutcome::Projected)));

    let mut builder = Builder::new();
    let o = builder.point(0.0, 0.0, true);
    let p = builder.point(1.0, 0.0, false);
    for _ in 0..100 { builder.equation(Kind::Distance, 1.0, &[o[0], o[1], p[0], p[1]]); }
    builder.temporary(Kind::Value, 2.0, &[p[0]]);
    builder.temporary(Kind::Value, 0.0, &[p[1]]);
    let (outcome, _) = builder.outcome_within(Limits { fill: 2_000_000, work: 5_000 });
    assert_eq!((outcome.status, outcome.drag), (Status::TooLarge, Some(DragOutcome::Stalled)));
}

#[test]
fn a_landing_keeps_every_target_on_one_coordinate_reached() {
    // Targets 7e-9 either side of a free value at zero: zero reaches both, landing on either does not.
    let mut builder = Builder::new();
    let p = builder.parameter(0.0, false);
    builder.temporary(Kind::Value, 7e-9, &[p]);
    builder.temporary(Kind::Value, -7e-9, &[p]);
    let (outcome, values) = builder.outcome();
    assert_eq!((outcome.status, outcome.drag), (Status::Converged, Some(DragOutcome::Reached)));
    assert_eq!(values[p], 0.0);
}

#[test]
fn a_fixed_group_whose_relations_fail_is_stalled() {
    let mut builder = Builder::new();
    let p = builder.parameter(0.0, true);
    builder.equation(Kind::Value, 1.0, &[p]);
    builder.temporary(Kind::Value, 2.0, &[p]);
    let (outcome, _) = builder.outcome();
    assert_eq!((outcome.status, outcome.drag), (Status::NotConverged, Some(DragOutcome::Stalled)));
}

#[test]
fn the_curvature_test_charges_its_reduced_matrix() {
    // 63 unit circles sharing x, each y dragged to zero and x out to 2: building the reduced
    // curvature matrix costs about 1e6 entries, which 3e6 does not leave room for.
    let mut builder = Builder::new();
    let zero = builder.parameter(0.0, true);
    let x = builder.parameter(1.0, false);
    for _ in 0..63 {
        let y = builder.parameter(0.0, false);
        builder.equation(Kind::Distance, 1.0, &[zero, zero, x, y]);
        builder.temporary(Kind::Value, 0.0, &[y]);
    }
    builder.temporary(Kind::Value, 2.0, &[x]);
    let (outcome, _) = builder.outcome_within(Limits { fill: 2_000_000, work: 3_000_000 });
    assert_eq!((outcome.status, outcome.drag), (Status::TooLarge, Some(DragOutcome::Stalled)));
    let (outcome, _) = builder.outcome_within(Limits { fill: 2_000_000, work: 400_000_000 });
    assert_eq!((outcome.status, outcome.drag), (Status::Converged, Some(DragOutcome::Projected)));
}

#[test]
fn the_curvature_test_charges_solves_over_rows_it_leaves_out() {
    // 64 unit circles tied in a line by zero distances, one tie repeated 20000 times: the repeats
    // are left out of the multipliers, but every solve still passes their damping.
    let mut builder = Builder::new();
    let zero = builder.parameter(0.0, true);
    let mut xs = Vec::new();
    for _ in 0..64 {
        let p = builder.point(1.0, 0.0, false);
        builder.equation(Kind::Distance, 1.0, &[zero, zero, p[0], p[1]]);
        builder.temporary(Kind::Value, 2.0, &[p[0]]);
        xs.push(p[0]);
    }
    for pair in xs.windows(2) { builder.equation(Kind::Distance, 0.0, &[pair[0], zero, pair[1], zero]); }
    for _ in 0..20_000 { builder.equation(Kind::Distance, 0.0, &[xs[0], zero, xs[1], zero]); }
    let (outcome, _) = builder.outcome_within(Limits { fill: 2_000_000, work: 1_000_000 });
    assert_eq!((outcome.status, outcome.drag), (Status::TooLarge, Some(DragOutcome::Stalled)));
}

#[test]
fn the_curvature_test_charges_its_frobenius_scans() {
    // 500 unit circles tied by collapsed distances, the first one's y held by a 30-link chain: the
    // Frobenius bound clears and sums a suffix of every position, about 1e6 entries uncounted before.
    let mut builder = Builder::new();
    let zero = builder.parameter(0.0, true);
    let (mut last, mut first) = (None, 0);
    for i in 0..500 {
        let p = builder.point(1.0, 0.0, false);
        if i == 0 { first = p[1]; }
        builder.equation(Kind::Distance, 1.0, &[zero, zero, p[0], p[1]]);
        if let Some(q) = last { builder.equation(Kind::Distance, 0.0, &[q, zero, p[0], zero]); }
        builder.temporary(Kind::Value, 2.0, &[p[0]]);
        last = Some(p[0]);
    }
    for _ in 0..30 {
        let p = builder.parameter(0.0, false);
        builder.equation(Kind::Difference, 0.0, &[first, p]);
        first = p;
    }
    builder.equation(Kind::Value, 0.0, &[first]);
    let (outcome, _) = builder.outcome_within(Limits { fill: 2_000_000, work: 2_000_000 });
    assert_eq!((outcome.status, outcome.drag), (Status::TooLarge, Some(DragOutcome::Stalled)));
}

#[test]
fn restoring_the_start_shares_the_drag_allowance() {
    // Ordering 30 targets on one value spends the drag's half of the work, so restoring x onto its
    // relation has none left and must not report the drag reached.
    let mut builder = Builder::new();
    let x = builder.parameter(0.0, false);
    builder.equation(Kind::Value, 1.0, &[x]);
    for _ in 0..30 { builder.temporary(Kind::Value, 1.0, &[x]); }
    let (outcome, values) = builder.outcome_within(Limits { fill: 1_000, work: 31 });
    assert_eq!((outcome.status, outcome.drag), (Status::TooLarge, Some(DragOutcome::Stalled)));
    assert_eq!(values[x], 0.0);
    let (outcome, values) = builder.outcome();
    assert_eq!((outcome.status, outcome.drag, values[x]), (Status::Converged, Some(DragOutcome::Reached), 1.0));
}

#[test]
fn coordinates_aligned_to_a_dimensioned_one_are_not_too_large() {
    // 200 coordinates tied to x0, which a value relation holds at zero: a linear group whose
    // ordering rewrites long lists, which the heap's charge must not multiply.
    let mut builder = Builder::new();
    let x0 = builder.parameter(0.0, false);
    builder.equation(Kind::Value, 0.0, &[x0]);
    for _ in 0..200 {
        let x = builder.parameter(0.0, false);
        builder.equation(Kind::Difference, 0.0, &[x0, x]);
    }
    builder.temporary(Kind::Value, 1.0, &[x0]);
    let (outcome, values) = builder.outcome();
    assert_eq!((outcome.status, outcome.drag), (Status::Converged, Some(DragOutcome::Projected)));
    assert!(values[x0].abs() <= 1e-30);
}

/// P on a circle of `radius` about a fixed origin and on the line x = `line`, from `start`, and
/// dragged toward `target` when there is one: `P`.
fn tangency(builder: &mut Builder, radius: f64, line: f64, start: [f64; 2], target: Option<[f64; 2]>) -> [usize; 2] {
    let o = builder.point(0.0, 0.0, true);
    let p = builder.point(start[0], start[1], false);
    builder.equation(Kind::Distance, radius, &[o[0], o[1], p[0], p[1]]);
    builder.equation(Kind::Value, line, &[p[0]]);
    if let Some(target) = target {
        builder.temporary(Kind::Value, target[0], &[p[0]]);
        builder.temporary(Kind::Value, target[1], &[p[1]]);
    }
    p
}

fn tangency_outcome(radius: f64, line: f64, start: [f64; 2], target: Option<[f64; 2]>) -> (Outcome, [f64; 2]) {
    let mut builder = Builder::new();
    let p = tangency(&mut builder, radius, line, start, target);
    let (outcome, values) = builder.outcome();
    (outcome, [values[p[0]], values[p[1]]])
}

#[test]
fn a_drag_onto_a_tangency_stops_short_where_rank_is_still_clear() {
    // At (r, 0) the circle touches x = r and both rows' gradients point along x, so rank there reads
    // redundant. Near it rank is too close to call; the drag stops where its relations are no more
    // dependent than at its start, and the sketch it leaves solves, drags and edits again.
    for radius in [10.0, 100.0, 1000.0] {
        for lift in [1e-3, 1e-5] {
            let (start, p) = tangency_outcome(radius, radius, [radius, lift * radius], None);
            assert_eq!((start.status, start.labels.clone()), (Status::Converged, vec![0; 2]), "{radius} {lift}");
            let mut landed = p;
            for drag in 0..2 {
                let (dragged, end) = tangency_outcome(radius, radius, landed, Some([radius, 0.0]));
                assert_eq!((dragged.status, dragged.drag, dragged.labels.clone()), (Status::Converged, Some(DragOutcome::Limited), vec![0; 4]), "{radius} {lift} {drag}");
                assert!((end[0] - radius).abs() <= 1e-12 * radius && end[1] > 0.0 && end[1] <= 2e-9 * radius, "{radius} {lift} {drag}: {end:?}");
                assert!((dragged.target_distance - end[1]).abs() <= 1e-3 * end[1], "{radius} {lift} {drag}: {}", dragged.target_distance);
                landed = end;
            }
            let (again, kept) = tangency_outcome(radius, radius, landed, None);
            assert_eq!((again.status, again.labels, kept), (Status::Converged, vec![0; 2], landed), "{radius} {lift}");
            let (edited, moved) = tangency_outcome(radius, radius - 1.0, landed, None);
            assert_eq!((edited.status, edited.diagnosis, edited.degrees_of_freedom), (Status::Converged, Diagnosis::Diagnosed, Some(0)), "{radius} {lift}");
            assert!((moved[0] - (radius - 1.0)).abs() <= 1e-12 * radius && (moved[1] - (2.0 * radius - 1.0).sqrt()).abs() <= 1e-9 * radius, "{radius} {lift}: {moved:?}");
        }
    }
}

#[test]
fn a_drag_that_stalls_where_its_relations_are_met_keeps_feasible_values() {
    // At (10, 1e-5) both rows are met to 5e-12 but not polished, and nothing is free. Every trial's
    // restoration polishes toward their double root at (10, 0), further than the trial moved, so a
    // drag toward a point between cannot step: it stalls where it began, its relations met,
    // diagnosed and blaming nothing, from the start and chained. The sketch it leaves solves again,
    // polished toward the double root, where rank is too close to call, and edits again.
    let start = [10.0, 1e-5];
    let mut landed = start;
    for k in [3.0, 2.0, 1.0] {
        for from in [start, landed] {
            let (dragged, end) = tangency_outcome(10.0, 10.0, from, Some([10.0, k * 2.5e-6]));
            assert_eq!((dragged.status, dragged.drag, dragged.diagnosis, dragged.degrees_of_freedom, dragged.labels.clone()),
                (Status::Converged, Some(DragOutcome::Stalled), Diagnosis::Diagnosed, Some(0), vec![0; 4]), "{k}");
            assert_eq!(end, start, "{k}");
            assert!((dragged.target_distance - (1e-5 - k * 2.5e-6)).abs() <= 1e-18, "{k}: {}", dragged.target_distance);
            landed = end;
        }
    }
    let (again, polished) = tangency_outcome(10.0, 10.0, landed, None);
    assert_eq!((again.status, again.diagnosis, again.labels), (Status::Converged, Diagnosis::Uncertain, vec![0; 2]));
    assert!((polished[0] - 10.0).abs() <= 1e-14 && polished[1].abs() < 1e-6, "{polished:?}");
    let (edited, moved) = tangency_outcome(10.0, 9.0, landed, None);
    assert_eq!((edited.status, edited.diagnosis, edited.degrees_of_freedom), (Status::Converged, Diagnosis::Diagnosed, Some(0)));
    assert!((moved[0] - 9.0).abs() <= 1e-12 && (moved[1] - 19f64.sqrt()).abs() <= 1e-9, "{moved:?}");
}

#[test]
fn a_stall_at_met_relations_out_of_work_is_too_large_at_its_start() {
    // Stepping a stall back from a singular end counts dependent rows; at every budget the drag is
    // either that stall or too large, and never leaves its start.
    let (mut stalls, mut exhausted) = (0, 0);
    for work in 0..=6000 {
        let mut builder = Builder::new();
        let p = tangency(&mut builder, 10.0, 10.0, [10.0, 1e-5], Some([10.0, 7.5e-6]));
        let (outcome, values) = builder.outcome_within(Limits { fill: usize::MAX, work });
        assert_eq!([values[p[0]], values[p[1]]], [10.0, 1e-5], "{work}");
        match (outcome.status, outcome.drag) {
            (Status::Converged, Some(DragOutcome::Stalled)) => stalls += 1,
            (Status::TooLarge, Some(DragOutcome::Stalled)) => exhausted += 1,
            other => panic!("{work}: {other:?}"),
        }
    }
    assert!(stalls > 0 && exhausted > 0, "{stalls} {exhausted}");
}

#[test]
fn a_feasible_stall_beside_a_landed_group_is_the_drag_outcome() {
    // The worse group decides the drag; the free point beside the stalled one still lands.
    let mut builder = Builder::new();
    let p = tangency(&mut builder, 10.0, 10.0, [10.0, 1e-5], Some([10.0, 7.5e-6]));
    let q = builder.point(50.0, 0.0, false);
    builder.temporary(Kind::Value, 55.0, &[q[0]]);
    builder.temporary(Kind::Value, 5.0, &[q[1]]);
    let (outcome, values) = builder.outcome();
    assert_eq!((outcome.status, outcome.drag, outcome.labels), (Status::Converged, Some(DragOutcome::Stalled), vec![0; 6]));
    assert_eq!(([values[p[0]], values[p[1]]], [values[q[0]], values[q[1]]]), ([10.0, 1e-5], [55.0, 5.0]));
}

#[test]
fn a_stalled_group_outranks_a_limited_one() {
    // One group stops short of a tangency; the other cannot meet distances 3 and 4 at once.
    let mut builder = Builder::new();
    tangency(&mut builder, 10.0, 10.0, [10.0, 1e-4], Some([10.0, 0.0]));
    let a = builder.point(50.0, 0.0, true);
    let q = builder.point(53.0, 0.0, false);
    builder.equation(Kind::Distance, 3.0, &[a[0], a[1], q[0], q[1]]);
    builder.equation(Kind::Distance, 4.0, &[a[0], a[1], q[0], q[1]]);
    builder.temporary(Kind::Value, 55.0, &[q[0]]);
    builder.temporary(Kind::Value, 5.0, &[q[1]]);
    let (outcome, _) = builder.outcome();
    assert_eq!((outcome.status, outcome.drag), (Status::NotConverged, Some(DragOutcome::Stalled)));
}

#[test]
fn every_frame_of_an_arm_stretched_past_its_reach_and_back_is_solved() {
    // Two 10 mm links from a fixed base, the tip pulled along y = 1 past its 20 mm reach and back
    // inside it, each frame from the start and from the last. Straight, the arm's rank is clear,
    // though its pivot columns are not: the second link's lead in the joint's columns is tiny.
    let arm = |joint: [f64; 2], tip: [f64; 2], target: Option<[f64; 2]>| {
        let mut builder = Builder::new();
        let b = builder.point(0.0, 0.0, true);
        let j = builder.point(joint[0], joint[1], false);
        let t = builder.point(tip[0], tip[1], false);
        builder.equation(Kind::Distance, 10.0, &[b[0], b[1], j[0], j[1]]);
        builder.equation(Kind::Distance, 10.0, &[j[0], j[1], t[0], t[1]]);
        if let Some(target) = target {
            builder.temporary(Kind::Value, target[0], &[t[0]]);
            builder.temporary(Kind::Value, target[1], &[t[1]]);
        }
        let (outcome, values) = builder.outcome();
        (outcome, [values[j[0]], values[j[1]]], [values[t[0]], values[t[1]]])
    };
    for chained in [false, true] {
        let (mut joint, mut tip) = ([6.0, 8.0], [16.0, 8.0]);
        for frame in 0..47 {
            let target = if frame < 46 { [10.0 + 0.25 * frame as f64, 1.0] } else { [15.0, 1.0] };
            let (outcome, j, t) = if chained { arm(joint, tip, Some(target)) } else { arm([6.0, 8.0], [16.0, 8.0], Some(target)) };
            let reached = target[0].hypot(target[1]) <= 20.0;
            assert_eq!((outcome.status, outcome.drag, outcome.labels.clone()), (Status::Converged, Some(if reached { DragOutcome::Reached } else { DragOutcome::Projected }), vec![0; 4]), "{chained} {frame}");
            assert_eq!((outcome.diagnosis, outcome.degrees_of_freedom), (Diagnosis::Diagnosed, Some(2)), "{chained} {frame}");
            let (again, ..) = arm(j, t, None);
            assert_eq!((again.status, again.diagnosis, again.degrees_of_freedom, again.labels), (Status::Converged, Diagnosis::Diagnosed, Some(2), vec![0; 2]), "{chained} {frame}");
            (joint, tip) = (j, t);
        }
    }
}
#[test]
fn a_drag_that_runs_out_of_work_is_too_large_rather_than_limited() {
    // A difference held twice, dragged: counting the dependent rows along the way runs out before
    // a rotation is made, which must read as running out, not as the drag growing more singular.
    let mut builder = Builder::new();
    let (x, y) = (builder.parameter(0.0, false), builder.parameter(0.0, false));
    for _ in 0..2 { builder.equation(Kind::Difference, 0.0, &[x, y]); }
    builder.temporary(Kind::Value, 1.0, &[x]);
    let (outcome, _) = builder.outcome_within(Limits { fill: usize::MAX, work: 278 });
    assert_eq!(outcome.status, Status::TooLarge);
    assert_ne!(outcome.drag, Some(DragOutcome::Limited));
}
