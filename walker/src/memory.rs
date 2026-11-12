//! The allocator the module uses in the browser. Every block is a power of two in size, and a freed
//! block goes on a list for its size, to be handed out again before new memory is taken. Memory is
//! never given back to the browser, which a WebAssembly module cannot do anyway. The engine allocates
//! when a world is built and reuses what it has after that, so the lists stay short.

use core::alloc::{GlobalAlloc, Layout};
use core::arch::wasm32;

const PAGE: usize = 65536;
/// Blocks run from 8 bytes (size 3) to 2 GiB (size 31).
const SIZES: usize = 32;

struct Heap {
    /// The first free block of each size, each one holding the address of the next.
    free: [usize; SIZES],
    /// Where untouched memory starts, and where it ends.
    next: usize,
    end: usize,
}

struct Allocator(crate::Shared<Heap>);

#[global_allocator]
static ALLOCATOR: Allocator = Allocator(crate::Shared::new(Heap { free: [0; SIZES], next: 0, end: 0 }));

/// The power of two a request is rounded up to.
fn size_of(layout: Layout) -> usize {
    let bytes = layout.size().max(layout.align()).max(8);
    (usize::BITS - (bytes - 1).leading_zeros()) as usize
}

unsafe impl GlobalAlloc for Allocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let heap = self.0.get();
        let size = size_of(layout);
        if size >= SIZES {
            return core::ptr::null_mut();
        }
        let head = heap.free[size];
        if head != 0 {
            heap.free[size] = unsafe { *(head as *const usize) };
            return head as *mut u8;
        }
        // a new block starts at a multiple of its size, up to a page, so that any alignment is met
        let bytes = 1usize << size;
        let align = bytes.min(PAGE);
        let start = (heap.next + align - 1) & !(align - 1);
        if start == 0 || start + bytes > heap.end {
            // memory this module has never used starts where the browser's current memory ends
            let pages = (bytes + align).div_ceil(PAGE).max(16);
            let old = wasm32::memory_grow(0, pages);
            if old == usize::MAX {
                return core::ptr::null_mut();
            }
            if old * PAGE != heap.end {
                heap.next = old * PAGE;
            }
            heap.end = (old + pages) * PAGE;
            return unsafe { self.alloc(layout) };
        }
        heap.next = start + bytes;
        start as *mut u8
    }

    unsafe fn dealloc(&self, block: *mut u8, layout: Layout) {
        let heap = self.0.get();
        let size = size_of(layout);
        unsafe { *(block as *mut usize) = heap.free[size] };
        heap.free[size] = block as usize;
    }

    unsafe fn realloc(&self, block: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let wanted = unsafe { Layout::from_size_align_unchecked(new_size, layout.align()) };
        if size_of(wanted) == size_of(layout) {
            return block;
        }
        let moved = unsafe { self.alloc(wanted) };
        if !moved.is_null() {
            unsafe { core::ptr::copy_nonoverlapping(block, moved, layout.size().min(new_size)) };
            unsafe { self.dealloc(block, layout) };
        }
        moved
    }
}
