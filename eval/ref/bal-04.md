<!-- header/footer: 4 Conservation of Linear Momentum; 2 -->

with boundary $\partial S_p$ and outward normal $\hat{\boldsymbol{n}}$,

$$\int_{\partial S_p} \boldsymbol{w}\cdot\hat{\boldsymbol{n}}\,\mathrm{d}a = \int_{S_p} \nabla\cdot\boldsymbol{w}\,\mathrm{d}v, \qquad \int_{\partial S_p} \boldsymbol{T}\cdot\hat{\boldsymbol{n}}\,\mathrm{d}a = \int_{S_p} \nabla\cdot\boldsymbol{T}\,\mathrm{d}v.$$

**Theorem 2.3 — Localisation Theorem.** If a continuous field $f$ satisfies $\int_{S_p} f\,\mathrm{d}v = 0$ for every choice of cut-out $S_p$, then $f \equiv 0$ at every point.

## 2.1 The Closed-System Identity

Mass is conserved, so for a closed system no mass crosses $\partial S_p$: $\frac{\mathrm{d}}{\mathrm{d}t}(\mathrm{d}m) = \frac{\mathrm{d}}{\mathrm{d}t}(\rho\,\mathrm{d}v) = 0$. Hence for any field $\phi$,

$$\frac{\mathrm{d}}{\mathrm{d}t}\int_{S_p} \rho\,\phi\,\mathrm{d}v = \frac{\mathrm{d}}{\mathrm{d}t}\int_{S_p} \phi\,\mathrm{d}m = \int_{S_p} \dot{\phi}\,\mathrm{d}m = \int_{S_p} \rho\,\dot{\phi}\,\mathrm{d}v.$$

## 3 Conservation of Mass

**Definition 3.1 — Mass of the Referential and Spatial Cuts.** Let $\rho_0(\boldsymbol{X})$ be the mass density in the reference configuration and $\rho(\boldsymbol{x}, t)$ the mass density in the current configuration. The mass of the referential cut $B_p$ and of the spatial cut $S_p = \varphi_t(B_p)$ are

$$M_{B_p} = \int_{B_p} \rho_0(\boldsymbol{X})\,\mathrm{d}V, \qquad M_{S_p} = \int_{S_p} \rho(\boldsymbol{x}, t)\,\mathrm{d}v.$$

Since $\mathrm{d}v = J\,\mathrm{d}V$, with $J = \det\boldsymbol{F}$, the equality $M_{B_p} = M_{S_p}$ reads $\int_{B_p} \rho_0\,\mathrm{d}V = \int_{B_p} \rho J\,\mathrm{d}V$ for an arbitrary $B_p$. Localisation (Theorem 2.3) gives

$$\rho_0(\boldsymbol{X}) = \rho(\boldsymbol{x}, t)\,J(\boldsymbol{X}, t).$$

Since $B_p$ is a fixed piece of the reference body, $\rho_0$ carries no explicit time dependence, so $\frac{\mathrm{d}}{\mathrm{d}t}M_{B_p} = 0$. Mass conservation therefore also requires $\frac{\mathrm{d}}{\mathrm{d}t}\int_{B_p} \rho J\,\mathrm{d}V = 0$. Localisation gives

$$\frac{\mathrm{d}}{\mathrm{d}t}(\rho J) = \dot{\rho} J + \rho\dot{J} = 0.$$

**Lemma 3.0.1 — Rate of the Jacobian.** $\dot{J} = J\,\nabla\cdot\boldsymbol{v}$.

**Proof Sketch.** $\dot{J} = \frac{\mathrm{d}}{\mathrm{d}t}\det(\boldsymbol{F}) = J\operatorname{tr}(\dot{\boldsymbol{F}}\boldsymbol{F}^{-1})$. Since $\dot{\boldsymbol{F}}\boldsymbol{F}^{-1} = \nabla\boldsymbol{v} = \boldsymbol{L}$, the spatial velocity gradient, and $\operatorname{tr}(\boldsymbol{L}) = \nabla\cdot\boldsymbol{v}$.

Substituting Lemma 3.0.1 and dividing by $J \neq 0$ yields the **continuity equation**:

$$\dot{\rho} + \rho\,\nabla\cdot\boldsymbol{v} = 0.$$

For an incompressible material, $\dot{\rho} = 0$, and the continuity equation reduces to $\nabla\cdot\boldsymbol{v} = 0$.

## 4 Conservation of Linear Momentum

**Definition 4.1 — Linear Momentum Balance.** The linear momentum of the spatial cut $S_p$ is $\boldsymbol{L}_{S_p} = \int_{S_p} \rho\boldsymbol{v}\,\mathrm{d}v$. The rate of change of linear momentum equals the net force acting on $S_p$, i.e. the body force (acting at a distance) plus the surface force (acting in the vicinity):

$$\frac{\mathrm{d}}{\mathrm{d}t}\int_{S_p} \rho\boldsymbol{v}\,\mathrm{d}v = \int_{S_p} \rho\boldsymbol{b}\,\mathrm{d}v + \int_{\partial S_p} \boldsymbol{t}\,\mathrm{d}a,$$

where $\boldsymbol{b}$ is the body force per unit mass in the current configuration and $\boldsymbol{t}$ is the Cauchy surface stress traction
