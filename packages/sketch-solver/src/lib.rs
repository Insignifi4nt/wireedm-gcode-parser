//! Sketch constraint solver core. The WebAssembly host copies an `f64` input buffer (see
//! `problem`) into memory from `buffer_alloc`, calls `solve` and frees both buffers with
//! `buffer_free`. The names avoid the C allocator's `alloc` and `free` on native hosts.

pub mod diagnose;
pub mod dual;
pub mod equations;
pub mod newton;
pub mod problem;
pub mod sparse;

use problem::{Diagnosis, Output, Status, decode, encode_output};

/// Decodes, solves and encodes one problem; invalid input returns its status and no values.
pub fn solve_buffer(input: &[f64]) -> Vec<f64> {
    match decode(input) {
        Some(problem) => {
            let mut values = problem.values.clone();
            let outcome = newton::solve(&problem, &mut values);
            encode_output(&Output { status: outcome.status, iterations: outcome.iterations, residual: outcome.residual,
                diagnosis: outcome.diagnosis, degrees_of_freedom: outcome.degrees_of_freedom, values: &values, labels: &outcome.labels })
        }
        None => encode_output(&Output { status: Status::InvalidInput, iterations: 0, residual: f64::NAN,
            diagnosis: Diagnosis::Unavailable, degrees_of_freedom: None, values: &[], labels: &[] }),
    }
}

/// Room for `len` `f64` values.
#[unsafe(no_mangle)]
pub extern "C" fn buffer_alloc(len: usize) -> *mut f64 {
    let mut buffer = Vec::<f64>::with_capacity(len);
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer
}

/// # Safety
/// `pointer` and `len` come from `buffer_alloc(len)` or from a `solve` output whose first value is `len`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn buffer_free(pointer: *mut f64, len: usize) {
    drop(unsafe { Vec::from_raw_parts(pointer, 0, len) });
}

/// Returns an output buffer whose first value is its own length.
///
/// # Safety
/// `pointer` holds `len` initialized values from `buffer_alloc(len)`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn solve(pointer: *const f64, len: usize) -> *mut f64 {
    let output = solve_buffer(unsafe { std::slice::from_raw_parts(pointer, len) });
    let mut output = std::mem::ManuallyDrop::new(output.into_boxed_slice());
    output.as_mut_ptr()
}
