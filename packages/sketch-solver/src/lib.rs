//! Sketch constraint solver core. The WebAssembly host copies an `f64` input buffer (see
//! `problem`) into memory from `alloc`, calls `solve` and frees both buffers with `free`.

pub mod dual;
pub mod equations;
pub mod newton;
pub mod problem;

use problem::{Status, decode, encode_output};

/// Decodes, solves and encodes one problem; invalid input returns its status and no values.
pub fn solve_buffer(input: &[f64]) -> Vec<f64> {
    match decode(input) {
        Some(problem) => {
            let mut values = problem.values.clone();
            let outcome = newton::solve(&problem, &mut values);
            encode_output(outcome.status, outcome.iterations, outcome.residual, &values)
        }
        None => encode_output(Status::InvalidInput, 0, f64::NAN, &[]),
    }
}

/// Room for `len` `f64` values.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut f64 {
    let mut buffer = Vec::<f64>::with_capacity(len);
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer
}

/// # Safety
/// `pointer` and `len` come from `alloc(len)` or from a `solve` output whose first value is `len`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn free(pointer: *mut f64, len: usize) {
    drop(unsafe { Vec::from_raw_parts(pointer, 0, len) });
}

/// Returns an output buffer whose first value is its own length.
///
/// # Safety
/// `pointer` holds `len` initialized values from `alloc(len)`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn solve(pointer: *const f64, len: usize) -> *mut f64 {
    let output = solve_buffer(unsafe { std::slice::from_raw_parts(pointer, len) });
    let mut output = std::mem::ManuallyDrop::new(output.into_boxed_slice());
    output.as_mut_ptr()
}
