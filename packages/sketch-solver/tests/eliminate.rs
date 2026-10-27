mod common;

use common::Builder;
use sketch_solver::diagnose::{CONFLICTING, REDUNDANT};
use sketch_solver::equations::Kind;
use sketch_solver::newton::{LIMITS, Limits, Outcome};
use sketch_solver::problem::Status;

type Solved = (Outcome, Vec<f64>);

/// Solved through its classes where it can be, and solved whole.
fn both(builder: &Builder) -> (Solved, Solved) { (builder.outcome_within(LIMITS), builder.outcome_whole_within(LIMITS)) }

/// Every part of the outcome and every bit of every value.
fn identical(a: &Solved, b: &Solved) -> bool {
    format!("{:?}", a.0) == format!("{:?}", b.0) && a.1.iter().map(|v| v.to_bits()).eq(b.1.iter().map(|v| v.to_bits()))
}

/// The same verdict, labels and freedom, with values that differ by roundoff at most.
fn agrees(a: &Solved, b: &Solved) -> bool {
    let (x, y) = (&a.0, &b.0);
    (x.status, x.diagnosis, x.degrees_of_freedom, &x.labels) == (y.status, y.diagnosis, y.degrees_of_freedom, &y.labels)
        && a.1.iter().zip(&b.1).all(|(&u, &v)| (u - v).abs() <= 1e-12 * u.abs().max(1.0))
}

/// Free parameters `x[0..4]` held apart by differences, the third pinned at 10 by `pin`.
fn chain(pin: impl FnOnce(&mut Builder, usize)) -> (Builder, [usize; 4]) {
    let mut builder = Builder::new();
    let x = [0.3, -1.0, 4.0, 2.5].map(|value| builder.parameter(value, false));
    builder.equation(Kind::Difference, 2.0, &[x[0], x[1]]);
    builder.equation(Kind::Difference, 3.0, &[x[1], x[2]]);
    builder.equation(Kind::Difference, -1.5, &[x[2], x[3]]);
    pin(&mut builder, x[2]);
    (builder, x)
}

#[test]
fn a_pinned_chain_is_placed_where_its_offsets_put_it_without_a_step() {
    let pins: [(&str, fn(&mut Builder, usize)); 3] = [
        ("value", |builder, p| builder.equation(Kind::Value, 10.0, &[p])),
        ("fixed below", |builder, p| { let f = builder.parameter(4.0, true); builder.equation(Kind::Difference, 6.0, &[f, p]); }),
        ("fixed above", |builder, p| { let f = builder.parameter(13.0, true); builder.equation(Kind::Difference, 3.0, &[p, f]); }),
    ];
    for (name, pin) in pins {
        let (builder, x) = chain(pin);
        let (eliminated, whole) = both(&builder);
        assert_eq!(x.map(|p| eliminated.1[p]), [5.0, 7.0, 10.0, 8.5], "{name}");
        assert_eq!((eliminated.0.status, eliminated.0.iterations, eliminated.0.degrees_of_freedom), (Status::Converged, 0, Some(0)), "{name}");
        assert!(whole.0.iterations > 0 && agrees(&eliminated, &whole), "{name}: {:?} {:?}", eliminated.0, whole.0);
    }
}

#[test]
fn a_free_class_starts_at_the_mean_of_its_members_less_their_offsets() {
    // Where every row is linear both reach the solution nearest the start: here the free class
    // moves its two members half the residual each.
    let mut builder = Builder::new();
    let a = builder.parameter(0.0, false);
    let b = builder.parameter(0.0, false);
    builder.equation(Kind::Difference, 2.0, &[a, b]);
    let (eliminated, whole) = both(&builder);
    assert_eq!((eliminated.1[a], eliminated.1[b], eliminated.0.iterations, eliminated.0.degrees_of_freedom), (-1.0, 1.0, 0, Some(1)));
    assert!(agrees(&eliminated, &whole), "{:?} {:?}", eliminated, whole);
}

#[test]
fn a_cycle_of_differences_closes_on_a_row_that_must_already_hold() {
    for (closing, met) in [(5.0, true), (6.0, false)] {
        let mut builder = Builder::new();
        let x = [0.0, 1.0, 2.0].map(|value| builder.parameter(value, false));
        builder.equation(Kind::Value, 1.0, &[x[0]]);
        builder.equation(Kind::Difference, 2.0, &[x[0], x[1]]);
        builder.equation(Kind::Difference, 3.0, &[x[1], x[2]]);
        builder.equation(Kind::Difference, closing, &[x[0], x[2]]);
        let (eliminated, whole) = both(&builder);
        if met {
            assert_eq!((x.map(|p| eliminated.1[p]), eliminated.0.iterations), ([1.0, 3.0, 6.0], 0));
            assert!(eliminated.0.labels.contains(&REDUNDANT) && agrees(&eliminated, &whole), "{:?} {:?}", eliminated.0, whole.0);
        } else {
            // Not met where the classes put it, so the group is solved whole from its start.
            assert!(whole.0.labels.contains(&CONFLICTING) && identical(&eliminated, &whole), "{:?} {:?}", eliminated.0, whole.0);
        }
    }
}

#[test]
fn a_class_pinned_twice_holds_its_second_pin_as_a_row_that_must_already_hold() {
    let seconds: [(&str, fn(&mut Builder, usize, f64)); 2] = [
        ("value", |builder, p, at| builder.equation(Kind::Value, at, &[p])),
        ("fixed", |builder, p, at| { let f = builder.parameter(at + 1.0, true); builder.equation(Kind::Difference, 1.0, &[p, f]); }),
    ];
    for (name, second) in seconds {
        for (at, met) in [(8.5, true), (9.0, false)] {
            let (mut builder, x) = chain(|builder, p| builder.equation(Kind::Value, 10.0, &[p]));
            second(&mut builder, x[3], at);
            let (eliminated, whole) = both(&builder);
            if met {
                assert_eq!((eliminated.1[x[3]], eliminated.0.iterations), (8.5, 0), "{name}");
                assert!(eliminated.0.labels.contains(&REDUNDANT) && agrees(&eliminated, &whole), "{name}: {:?} {:?}", eliminated.0, whole.0);
            } else {
                assert!(whole.0.labels.contains(&CONFLICTING) && identical(&eliminated, &whole), "{name}: {:?} {:?}", eliminated.0, whole.0);
            }
        }
    }
}

#[test]
fn a_midpoint_left_over_a_class_is_solved_in_its_column() {
    // `v - u = 4` makes one class of `u` and `v`, whose midpoint is held at the chain's `x[1]`.
    let (mut builder, x) = chain(|builder, p| builder.equation(Kind::Value, 10.0, &[p]));
    let u = builder.parameter(1.0, false);
    let v = builder.parameter(3.0, false);
    builder.equation(Kind::Difference, 4.0, &[u, v]);
    builder.equation(Kind::Midpoint, 0.0, &[u, v, x[1]]);
    let (eliminated, whole) = both(&builder);
    assert!((eliminated.1[u] - 5.0).abs() <= 1e-12 && (eliminated.1[v] - 9.0).abs() <= 1e-12, "{:?}", eliminated.1);
    assert_eq!((eliminated.0.status, eliminated.0.degrees_of_freedom), (Status::Converged, Some(0)));
    assert!(agrees(&eliminated, &whole), "{:?} {:?}", eliminated, whole);
}

#[test]
fn a_repeated_midpoint_is_solved_whole() {
    // Left to solve, a dependent row that holds only nearly would be traded against the others by
    // the whole solve, so any dependent row but a constant one sends the group whole.
    for (second, agreeing) in [(5.0, true), (6.0, false)] {
        let mut builder = Builder::new();
        let u = builder.parameter(0.0, false);
        let v = builder.parameter(10.0, false);
        let m = builder.parameter(5.0, true);
        let n = builder.parameter(second, true);
        builder.equation(Kind::Difference, 4.0, &[u, v]);
        builder.equation(Kind::Midpoint, 0.0, &[u, v, m]);
        builder.equation(Kind::Midpoint, 0.0, &[v, u, n]);
        let (eliminated, whole) = both(&builder);
        let label = if agreeing { REDUNDANT } else { CONFLICTING };
        assert!(whole.0.labels.contains(&label) && identical(&eliminated, &whole), "{:?} {:?}", eliminated.0, whole.0);
    }
}

#[test]
fn pins_that_hold_only_nearly_are_solved_whole() {
    // Within tolerance of each other, but not equal: the classes would hold the first and leave the
    // others nearly met, where the whole solve spreads what they miss and does not converge.
    let mut builder = Builder::new();
    let a = builder.parameter(10.0, false);
    let b = builder.parameter(10.0, false);
    builder.equation(Kind::Value, 0.0, &[a]);
    builder.equation(Kind::Value, 9e-11, &[b]);
    builder.equation(Kind::Value, 9e-11, &[b]);
    builder.equation(Kind::Value, -9e-11, &[b]);
    builder.equation(Kind::Difference, 0.0, &[a, b]);
    let (eliminated, whole) = both(&builder);
    assert!(identical(&eliminated, &whole), "{:?} {:?}", eliminated.0, whole.0);
}

#[test]
fn far_from_the_origin_the_whole_solve_stops_within_its_tolerance_of_where_the_classes_land() {
    // Each solve stops once its rows are polished, within a tolerance that grows with the
    // coordinates: here the whole solve stops about 1.2e-7 mm short of the solution.
    let mut builder = Builder::new();
    let f = builder.parameter(-1e9, true);
    let x = builder.parameter(1e9 + 0.2, false);
    let y = builder.parameter(0.0, false);
    builder.equation(Kind::Value, 1e9, &[x]);
    builder.equation(Kind::Midpoint, 0.0, &[f, x, y]);
    let (eliminated, whole) = both(&builder);
    assert_eq!((eliminated.1[x], eliminated.1[y]), (1e9, 0.0));
    let (e, w) = (&eliminated.0, &whole.0);
    assert_eq!((e.status, e.diagnosis, e.degrees_of_freedom, &e.labels), (w.status, w.diagnosis, w.degrees_of_freedom, &w.labels));
    assert!(e.status == Status::Converged && whole.1[y] != 0.0 && whole.1[y].abs() < 1e-6, "{:?} {:?}", whole.0, whole.1);
}

#[test]
fn a_group_with_a_bent_row_is_solved_whole() {
    // Found by the random sketches below: after elimination two distances are left over two free
    // classes, at full rank, yet the first alone holds `p2y` at 22.5 or at -36.5. Solved through
    // its classes the group reached 22.5, and solved whole it reaches -36.5.
    let mut builder = Builder::new();
    let p: Vec<usize> = [-46.9, -25.25, -13.0, 8.649999999999999, 19.849999999999994, 8.25, 23.150000000000006, 40.8, -42.55, 1.3999999999999986, -27.55, -46.1]
        .into_iter().map(|value| builder.parameter(value, false)).collect();
    builder.equation(Kind::Distance, 31.852435221760956, &[p[2], p[3], p[4], p[5]]);
    builder.equation(Kind::Value, 0.0, &[p[4]]);
    builder.equation(Kind::Value, 0.0, &[p[1]]);
    builder.equation(Kind::Distance, 75.0847541336249, &[p[0], p[1], p[4], p[5]]);
    builder.equation(Kind::Value, 12.0, &[p[2]]);
    builder.equation(Kind::Difference, -1.0, &[p[11], p[1]]);
    builder.equation(Kind::Difference, -5.0, &[p[9], p[1]]);
    builder.equation(Kind::Difference, 7.0, &[p[3], p[1]]);
    builder.equation(Kind::Difference, 3.0, &[p[8], p[6]]);
    builder.equation(Kind::Difference, -3.0, &[p[7], p[3]]);
    let (eliminated, whole) = both(&builder);
    assert!((whole.1[p[5]] + 36.50555252077951).abs() <= 1e-9, "{:?}", whole.1);
    // The bent group is solved whole; the separate level `p[6]`, `p[8]` is eliminated.
    assert!([0, 1, 2, 3, 4, 5, 7, 9, 11].iter().all(|&i| eliminated.1[p[i]].to_bits() == whole.1[p[i]].to_bits()) && agrees(&eliminated, &whole), "{:?} {:?}", eliminated, whole);
}

#[test]
fn a_drag_and_a_polished_start_are_solved_whole() {
    let (mut dragged, x) = chain(|builder, p| builder.equation(Kind::Value, 10.0, &[p]));
    dragged.temporary(Kind::Value, 6.0, &[x[0]]);
    let (eliminated, whole) = both(&dragged);
    assert!(identical(&eliminated, &whole), "{:?} {:?}", eliminated, whole);
    let mut polished = Builder::new();
    let x = [5.0, 7.0, 10.0].map(|value| polished.parameter(value, false));
    polished.equation(Kind::Difference, 2.0, &[x[0], x[1]]);
    polished.equation(Kind::Difference, 3.0, &[x[1], x[2]]);
    polished.equation(Kind::Value, 10.0, &[x[2]]);
    let (eliminated, whole) = both(&polished);
    assert!(whole.0.iterations == 0 && identical(&eliminated, &whole), "{:?} {:?}", eliminated, whole);
}

#[test]
fn within_any_work_a_group_is_solved_through_its_classes_or_whole_at_that_work() {
    let (builder, _) = chain(|builder, p| builder.equation(Kind::Value, 10.0, &[p]));
    let full = builder.outcome_within(LIMITS);
    assert!(full.0.iterations == 0 && !identical(&full, &builder.outcome_whole_within(LIMITS)));
    let (mut through, mut whole) = (0, 0);
    for work in (0..40).map(|k| (1.6f64.powi(k) as usize).min(LIMITS.work)) {
        let limits = Limits { work, ..LIMITS };
        let (within, at) = (builder.outcome_within(limits), builder.outcome_whole_within(limits));
        if identical(&within, &at) { whole += 1; continue; }
        through += 1;
        assert!(within.1.iter().map(|v| v.to_bits()).eq(full.1.iter().map(|v| v.to_bits())) && within.0.status == full.0.status && within.0.iterations == full.0.iterations,
            "work {work}: {:?} against {:?}", within.0, full.0);
    }
    assert!(through > 0 && whole > 0, "through {through}, whole {whole}");
}

/// Seeded random sketches of free and fixed points held level, plumb and pinned by simple
/// equalities, some also held at distances where they start. Each is solved through its classes
/// to the whole solve's answer, to roundoff, or exactly as the whole solve answers it.
#[test]
fn random_sketches_agree_with_the_whole_solve() {
    let mut state = 0x9e37_79b9_7f4a_7c15u64;
    let mut next = move || { state ^= state << 13; state ^= state >> 7; state ^= state << 17; state };
    let (mut through, mut whole) = (0, 0);
    for seed in 0..400 {
        let mut builder = Builder::new();
        let count = 2 + (next() % 5) as usize;
        let points: Vec<[usize; 2]> = (0..count).map(|_| {
            let at = |next: &mut dyn FnMut() -> u64| (next() % 2001) as f64 / 20.0 - 50.0;
            let (x, y) = (at(&mut next), at(&mut next));
            builder.point(x, y, next() % 5 == 0)
        }).collect();
        for _ in 0..(1 + next() % (2 * count as u64 + 2)) {
            let (i, j) = ((next() as usize) % count, (next() as usize) % count);
            let axis = (next() % 2) as usize;
            let offset = (next() % 21) as f64 - 10.0;
            match next() % 5 {
                0 if i != j => builder.equation(Kind::Difference, offset, &[points[i][axis], points[j][axis]]),
                1 => builder.equation(Kind::Value, offset * 3.0, &[points[i][axis]]),
                2 if i != j => {
                    let (p, q) = (points[i], points[j]);
                    let length = (builder.values[q[0]] - builder.values[p[0]]).hypot(builder.values[q[1]] - builder.values[p[1]]);
                    if length > 1.0 { builder.equation(Kind::Distance, length + offset / 10.0, &[p[0], p[1], q[0], q[1]]); }
                }
                3 if i != j => {
                    let k = (next() as usize) % count;
                    if k != i && k != j { builder.equation(Kind::Midpoint, 0.0, &[points[i][axis], points[j][axis], points[k][axis]]); }
                }
                _ => {}
            }
        }
        let (eliminated, solved) = both(&builder);
        if identical(&eliminated, &solved) { whole += 1; continue; }
        through += 1;
        assert!(agrees(&eliminated, &solved), "seed {seed}: {:?} {:?}", eliminated, solved);
    }
    assert!(through > 40 && whole > 40, "through {through}, whole {whole}");
}
