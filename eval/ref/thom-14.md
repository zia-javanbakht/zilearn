### A.3 Why emphasize that the deformation gradient is affine?

**Answer.** An affine map is linear plus a constant offset. With $\mathbf{H} = \operatorname{Grad}\mathbf{u}$,

$$\mathbf{F}(\mathbf{H}) = \mathbf{I} + \mathbf{H}.$$

The offset is $\mathbf{I}$, so this map is not strictly linear: $\mathbf{F}(\mathbf{0}) = \mathbf{I} \neq \mathbf{0}$. However, its increment is linear,

$$\Delta\mathbf{F} = \operatorname{Grad}\Delta\mathbf{u},$$

and its second derivative with respect to displacement vanishes. Thus, forming $\mathbf{F}$ from $\mathbf{u}$ does not introduce a nonlinear dependence.

By comparison, the Green–Lagrange strain contains a quadratic term:

$$\mathbf{E} = \frac{1}{2}(\mathbf{H} + \mathbf{H}^T + \mathbf{H}^T\mathbf{H}).$$

Even a constitutive law linear in $\mathbf{E}$, such as $\mathbf{S} = \mathbb{C} : \mathbf{E}$, generally yields a nonlinear displacement problem because

$$\mathbf{P} = (\mathbf{I} + \mathbf{H})\big[\mathbb{C} : \mathbf{E}(\mathbf{H})\big].$$

The term *affine* indicates where the nonlinearity enters. It does not imply a spatially uniform deformation gradient: $\mathbf{F}(\mathbf{X})$ can vary throughout the body. This is distinct from calling the deformation map itself affine in $\mathbf{X}$, which would yield a constant $\mathbf{F}$.

<!-- header/footer: NONLINEAR SOLID MECHANICS | Strong forms, weak forms, and consistent tangents | Dr. Lonny L. Thompson, Clemson University, Sept 25, 2026. | 14 / 29 -->
