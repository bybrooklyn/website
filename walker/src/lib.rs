//! The walking mini's engine. A small 2D physics engine (`physics`), a creature built in it from a
//! description (`body`), a little network that drives it (`brain`), and evolution that teaches it to
//! walk (`learn`). The page reaches it through plain exported functions (`api` and `physics::api`),
//! described in README.md.
//!
//! In the browser it runs without the standard library, on its own allocator (`memory`) and its own
//! sine, square root and the rest (`math`), so the module stays small and gives the same numbers on
//! every machine. Natively, for `cargo test`, the standard library is there as usual.

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

pub mod math;
pub mod physics;

#[cfg(feature = "walker")]
pub mod body;
#[cfg(feature = "walker")]
pub mod brain;
#[cfg(feature = "walker")]
pub mod learn;
#[cfg(feature = "walker")]
pub mod gait;
#[cfg(feature = "walker")]
pub mod show;
#[cfg(feature = "walker")]
pub mod api;

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



