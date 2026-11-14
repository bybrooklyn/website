//! The sand mini's engine: a grid of cells, each of one material, that fall, flow and rise by
//! simple rules (`world`), with water carried through a connected body so that it finds one level
//! (`level`), that change alone or with a neighbor by the lines of a table (`react`), and whose
//! heat spreads to their neighbors (`heat`). What each material is, and what it becomes, lives in
//! tables (`materials`). The page reaches it through plain exported functions (`api`), described
//! in README.md.
//!
//! In the browser it runs without the standard library, on its own allocator (`memory`). The step
//! uses no floating point, and the brush only sums, products and one division, which every machine
//! rounds the same way, so the same world and the same strokes give the same cells to the byte on
//! every machine. Natively, for `cargo test`, the standard library is there as usual.

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

pub mod api;
pub mod heat;
pub mod level;
pub mod materials;
pub mod react;
pub mod world;

#[cfg(target_arch = "wasm32")]
mod memory;

/// A panic in the browser stops the module where it is. There is nobody to read a message, and
/// leaving out the code that formats one keeps the module small.
#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

/// One value the whole module shares. The browser runs the module on one thread, so the page's calls
/// never overlap, which is what makes handing out the inside safe.
pub(crate) struct Shared<T>(core::cell::UnsafeCell<T>);

unsafe impl<T> Sync for Shared<T> {}

impl<T> Shared<T> {
    pub(crate) const fn new(value: T) -> Self {
        Shared(core::cell::UnsafeCell::new(value))
    }

    /// The value, to change. Callers take it once per exported call and do not keep it.
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn get(&self) -> &mut T {
        unsafe { &mut *self.0.get() }
    }
}
