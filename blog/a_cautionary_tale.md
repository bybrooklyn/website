---
title: A cautionary tale
date: 15-03-2025
---

So, I, being the animation connoisseur that I am, one boring evening decided to implement cubic Bézier easing in rubato (as one does on boring evenings).

Thus, with my cat ears and thigh highs on, off I went in search of resources on Bézier curves. Upon discovering [several](https://stackoverflow.com/questions/2549706/quadratic-bezier-curve-y-coordinate-for-a-given-x) [Stack Overflow](https://math.stackexchange.com/questions/26846/is-there-an-explicit-form-for-cubic-b%c3%a9zier-curves/348645#348645) [posts](https://stackoverflow.com/questions/34455714/custom-animation-using-cubic-bezier-function) and spending a good two days pounding my head against the wall, I finally managed to find an [implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/UnitBezier.h) (which still needed to be adapted to use the derivatives that rubato required). After first trying my hand at that using https://pomax.github.io/bezierinfo as a reference—failing miserably—and even bothering my local smart person, missing, for help (which also failed, because derivatives), I decided to contact the author of rubato, [Orlando](https://github.com/andOrlando).

We spent about an hour discussing a solution to my predicament, and in the end we came to the conclusion that while a cubic easing function could be approximated by tweaking the intro and outro durations and altering the easing function, I should simply use another library that doesn't use derivatives for specifying the easing function. This stemmed from the fact that for every well-defined cubic Bézier curve (i.e., `A = (0,0)`, `D = (1,1)`, and `B` and `C` are both in the range `[0–1]`), both the start and the end of the function would be at `y = 0`, making it incompatible with rubato's model (except when intro = 1, which would defeat the purpose of using rubato as an interrupt-friendly interpolator in the first place).

The moral of the story? Don’t rice, kids.
