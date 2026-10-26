//! Small dense symmetric eigenproblems, for curvature tests over a few columns.

/// Most cyclic Jacobi sweeps; each sweep at least squares the off-diagonal norm once it is small.
const SWEEPS: usize = 64;

/// Eigenvalues and unit eigenvectors of the symmetric matrix `a`, by cyclic Jacobi rotations;
/// `vectors[k]` belongs to `values[k]`. Only the upper triangle of `a` is read.
pub fn symmetric_eigen(mut a: Vec<Vec<f64>>) -> (Vec<f64>, Vec<Vec<f64>>) {
    let n = a.len();
    for i in 0..n { for j in 0..i { a[i][j] = a[j][i]; } }
    // Rows of `v` are the eigenvectors.
    let mut v: Vec<Vec<f64>> = (0..n).map(|i| (0..n).map(|j| if i == j { 1.0 } else { 0.0 }).collect()).collect();
    let total = a.iter().flatten().map(|x| x * x).sum::<f64>().sqrt();
    for _ in 0..SWEEPS {
        let off = (0..n).flat_map(|i| (i + 1..n).map(move |j| (i, j))).map(|(i, j)| a[i][j] * a[i][j]).sum::<f64>().sqrt();
        if !(off > f64::EPSILON * f64::EPSILON * total) { break; }
        for p in 0..n {
            for q in p + 1..n {
                if a[p][q] == 0.0 { continue; }
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
    ((0..n).map(|i| a[i][i]).collect(), v)
}
