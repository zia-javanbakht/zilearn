[Figure image]

Figure 4. Three equivalent representations of internal virtual work. The spatial work density must be paired with the current volume measure.

## 6 Hyperelastic Variational Form

For a hyperelastic material under conservative loading, equilibrium is a stationarity condition. The explicit expression below assumes *dead loads*: $\mathbf{b}$ and $\bar{\mathbf{T}}$ are prescribed independently of the deformation in reference coordinates. Define

$$\Pi(\boldsymbol{\varphi}) = \int_{\mathcal{B}_0} \Psi(\operatorname{Grad}\boldsymbol{\varphi}, \mathbf{X})\,\mathrm{d}V - \int_{\mathcal{B}_0} \rho_0\mathbf{b}\cdot\boldsymbol{\varphi}\,\mathrm{d}V - \int_{\Gamma_T} \bar{\mathbf{T}}\cdot\boldsymbol{\varphi}\,\mathrm{d}A.$$

The equilibrium deformation satisfies

$$\delta\Pi(\boldsymbol{\varphi};\boldsymbol{\eta}) = 0 \qquad \forall\boldsymbol{\eta} \in \mathcal{V}_0.$$

Replacing $\boldsymbol{\varphi}$ by $\mathbf{u}$ in the dead-load potential changes only a constant. For other conservative loads, the appropriate load potential must be used. Stationarity alone does not imply a minimum or stability.

Taking the first variation,

$$\delta\Pi = \int_{\mathcal{B}_0} \frac{\partial\Psi}{\partial\mathbf{F}} : \delta\mathbf{F}\,\mathrm{d}V - \int_{\mathcal{B}_0} \rho_0\mathbf{b}\cdot\boldsymbol{\eta}\,\mathrm{d}V - \int_{\Gamma_T} \bar{\mathbf{T}}\cdot\boldsymbol{\eta}\,\mathrm{d}A.$$

Since

$$\mathbf{P} = \frac{\partial\Psi}{\partial\mathbf{F}}, \qquad \delta\mathbf{F} = \operatorname{Grad}\boldsymbol{\eta},$$

we recover

$$\int_{\mathcal{B}_0} \mathbf{P} : \operatorname{Grad}\boldsymbol{\eta}\,\mathrm{d}V = \int_{\mathcal{B}_0} \rho_0\mathbf{b}\cdot\boldsymbol{\eta}\,\mathrm{d}V + \int_{\Gamma_T} \bar{\mathbf{T}}\cdot\boldsymbol{\eta}\,\mathrm{d}A.$$

Thus, for conservative hyperelasticity,

$$\text{weak equilibrium} \iff \text{stationarity of total potential energy.}$$

## 7 Spatial Form

The equilibrium equation can be expressed in the current configuration $\mathcal{B}_t$. The strong form is

$$\operatorname{div}\boldsymbol{\sigma} + \rho\mathbf{b} = \mathbf{0} \qquad \text{in } \mathcal{B}_t,$$

with the traction condition

$$\boldsymbol{\sigma}\mathbf{n} = \bar{\mathbf{t}} \qquad \text{on } \gamma_t.$$

The corresponding weak form is

$$\int_{\mathcal{B}_t} \boldsymbol{\sigma} : \nabla_x\mathbf{w}\,\mathrm{d}v = \int_{\mathcal{B}_t} \rho\mathbf{b}\cdot\mathbf{w}\,\mathrm{d}v + \int_{\gamma_t} \bar{\mathbf{t}}\cdot\mathbf{w}\,\mathrm{d}a$$

<!-- header/footer: NONLINEAR SOLID MECHANICS | Strong forms, weak forms, and consistent tangents | Dr. Lonny L. Thompson, Clemson University, Sept 25, 2026. | 5 / 29 -->
