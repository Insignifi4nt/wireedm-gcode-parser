//! Small dense symmetric eigenproblems, for curvature tests over a few columns.

/// Most cyclic Jacobi sweeps; each sweep at least squares the off-diagonal norm once it is small.
const SWEEPS: usize = 64;

/// Eigenvalues and unit eigenvectors of the symmetric matrix `a`, by cyclic Jacobi rotations;
/// `vectors[k]` belongs to `values[k]`. Only the upper triangle of `a` is read. Also the entries
/// read and written; `None` once they would pass `allowance`, checked before each step.
pub fn symmetric_eigen(mut a: Vec<Vec<f64>>, allowance: usize) -> Option<(Vec<f64>, Vec<Vec<f64>>, usize)> {
    let n = a.len();
    let mut work = n * n;
    if work > allowance { return None; }
    for i in 0..n { for j in 0..i { a[i][j] = a[j][i]; } }
    // Rows of `v` are the eigenvectors.
    let mut v: Vec<Vec<f64>> = (0..n).map(|i| (0..n).map(|j| if i == j { 1.0 } else { 0.0 }).collect()).collect();
    let total = a.iter().flatten().map(|x| x * x).sum::<f64>().sqrt();
    for _ in 0..SWEEPS {
        work += n * n;
        if work > allowance { return None; }
        let off = (0..n).flat_map(|i| (i + 1..n).map(move |j| (i, j))).map(|(i, j)| a[i][j] * a[i][j]).sum::<f64>().sqrt();
        if !(off > f64::EPSILON * f64::EPSILON * total) { break; }
        for p in 0..n {
            for q in p + 1..n {
                if a[p][q] == 0.0 { continue; }
                work += 6 * n;
                if work > allowance { return None; }
                let theta = (a[q][q] - a[p][p]) / (2.0 * a[p][q]);
                let t = theta.signum() / (theta.abs() + (theta * theta + 1.0).sqrt());
                let t = if theta == 0.0 { 1.0 } else { t };
                let c = 1.0 / (t * t + 1.0).sqrt();
                let s = t * c;
                for k in 0..n {
                    let (kp, kq) = (a[k][p], a[k][q]);
                    a[k][p] = c * kp - s * kq;
                    a[k][q] = s * kp + c * kq;
                }
                for k in 0..n {
                    let (pk, qk) = (a[p][k], a[q][k]);
                    a[p][k] = c * pk - s * qk;
                    a[q][k] = s * pk + c * qk;
                }
                for k in 0..n {
                    let (vp, vq) = (v[p][k], v[q][k]);
                    v[p][k] = c * vp - s * vq;
                    v[q][k] = s * vp + c * vq;
                }
            }
        }
    }
    Some(((0..n).map(|i| a[i][i]).collect(), v, work))
}

/// Singular values and right singular vectors of the matrix whose columns are `columns`, all of
/// one length: a Householder triangle `R`, then the eigenpairs of `[[0, R], [R^T, 0]]`, which are
/// `±sigma`. Small singular values keep an absolute accuracy of about `epsilon |R|`, where those of
/// `R^T R` would square it. `vectors[k]` belongs to `values[k]`; values come largest first. Also
/// the entries read and written; `None` once they would pass `allowance`, checked before each step.
pub fn singular(columns: &[Vec<f64>], allowance: usize) -> Option<(Vec<f64>, Vec<Vec<f64>>, usize)> {
    let s = columns.len();
    let n = columns.first().map_or(0, Vec::len);
    let triangle = 2 * s * s * n;
    // The triangle, then the joined matrix that the eigenproblem counts first.
    if triangle.saturating_add(4 * s * s) > allowance { return None; }
    let mut a = columns.to_vec();
    for k in 0..s.min(n) {
        let size = a[k][k..].iter().map(|x| x * x).sum::<f64>().sqrt();
        if size == 0.0 { continue; }
        let alpha = if a[k][k] > 0.0 { -size } else { size };
        let mut v = a[k][k..].to_vec();
        v[0] -= alpha;
        let length = v.iter().map(|x| x * x).sum::<f64>();
        if length == 0.0 { continue; }
        for column in a.iter_mut().skip(k) {
            let scale = 2.0 * v.iter().zip(&column[k..]).map(|(v, x)| v * x).sum::<f64>() / length;
            for (x, v) in column[k..].iter_mut().zip(&v) { *x -= scale * v; }
        }
    }
    let mut joined = vec![vec![0.0; 2 * s]; 2 * s];
    for j in 0..s { for i in 0..=j.min(n.saturating_sub(1)) { if i < n { joined[i][s + j] = a[j][i]; } } }
    let (values, vectors, work) = symmetric_eigen(joined, allowance - triangle)?;
    // Largest first, by insertion: the matrices are small.
    let mut order: Vec<usize> = Vec::with_capacity(2 * s);
    for k in 0..2 * s {
        let mut at = order.len();
        while at > 0 && values[order[at - 1]] < values[k] { at -= 1; }
        order.insert(at, k);
    }
    order.truncate(s);
    let right = |k: usize| {
        let v = &vectors[k][s..];
        let length = v.iter().map(|x| x * x).sum::<f64>().sqrt();
        v.iter().map(|x| if length > 0.0 { x / length } else { 0.0 }).collect::<Vec<f64>>()
    };
    Some((order.iter().map(|&k| values[k].max(0.0)).collect(), order.iter().map(|&k| right(k)).collect(), triangle + work))
}
