//! Shared glue: memory in and out of the module, and one place to hold a result.
use std::cell::RefCell;

thread_local! { static OUT: RefCell<Vec<u8>> = RefCell::new(Vec::new()); static INFO: RefCell<[u32; 4]> = RefCell::new([0; 4]); }

pub fn set_out(v: Vec<u8>) -> i32 { let n = v.len() as i32; OUT.with(|o| *o.borrow_mut() = v); n }
pub fn set_info(a: [u32; 4]) { INFO.with(|i| *i.borrow_mut() = a); }

/// Safety: the caller passes a pointer and length the page wrote with `q_alloc`.
pub unsafe fn input<'a>(p: *const u8, n: usize) -> &'a [u8] { unsafe { std::slice::from_raw_parts(p, n) } }

#[macro_export]
macro_rules! exports { () => {
    #[unsafe(no_mangle)] pub extern "C" fn q_alloc(n: usize) -> *mut u8 { $crate::hook(); let mut v = Vec::<u8>::with_capacity(n); let p = v.as_mut_ptr(); std::mem::forget(v); p }
    #[unsafe(no_mangle)] pub unsafe extern "C" fn q_free(p: *mut u8, n: usize) { unsafe { drop(Vec::from_raw_parts(p, 0, n)) } }
    #[unsafe(no_mangle)] pub extern "C" fn q_out_ptr() -> *const u8 { $crate::out_ptr() }
    #[unsafe(no_mangle)] pub extern "C" fn q_info(i: usize) -> u32 { $crate::info(i) }
}}
pub fn out_ptr() -> *const u8 { OUT.with(|o| o.borrow().as_ptr()) }
pub fn info(i: usize) -> u32 { INFO.with(|x| x.borrow()[i]) }

#[cfg(feature = "panic-log")]
unsafe extern "C" { fn q_panic(p: *const u8, n: usize); }
/// With `panic-log`, a panic message is handed to the page before the module aborts.
pub fn hook() {
    #[cfg(feature = "panic-log")]
    { static ONCE: std::sync::Once = std::sync::Once::new(); ONCE.call_once(|| std::panic::set_hook(Box::new(|i| { let s = i.to_string(); unsafe { q_panic(s.as_ptr(), s.len()) } }))); }
}
