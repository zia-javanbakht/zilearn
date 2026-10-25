<!-- header/footer: 6 Balance of Energy: The First Law of Thermodynamics; 4 -->

and using Cauchy's equation of motion (10) pointwise, $\rho a_k = \rho b_k + (\nabla\cdot\boldsymbol{\sigma})_k$, the terms containing $\boldsymbol{x}$ cancel, leaving

$$\int_{S_p} \varepsilon_{ijk}\sigma_{kj}\,\mathrm{d}v = 0$$

for an arbitrary $S_p$. Localisation (Theorem 2.3) forces $\varepsilon_{ijk}\sigma_{kj} = 0$ for every $i$, which is the statement $\sigma_{jk} = \sigma_{kj}$:

$$\boldsymbol{\sigma} = \boldsymbol{\sigma}^{\mathrm{T}}.$$

## 6 Balance of Energy: The First Law of Thermodynamics

**Definition 6.1 — Energy of the Spatial Cut.** The total energy of the sub-body $S_p$ is the sum of kinetic energy $K$ and internal energy $U$,

$$\mathcal{E}_{S_p} = K + U, \qquad K = \int_{S_p} \tfrac{1}{2}\rho\,\boldsymbol{v}\cdot\boldsymbol{v}\,\mathrm{d}v, \qquad U = \int_{S_p} \rho e\,\mathrm{d}v,$$

with $e$ the mass-specific internal energy density. The rate of change of the total energy equals the external mechanical power input $\mathcal{P}_{\mathrm{ext}}$ (rate at which the surface traction $\boldsymbol{t}$ and body force $\boldsymbol{b}$ perform work on $S_p$) plus the thermal power $\mathcal{Q}$ (rate of heat input — the outward flux through $\partial S_p$ plus a distributed internal heat source of intensity $r$ per unit mass):

$$\dot{\mathcal{E}}_{S_p} = \mathcal{P}_{\mathrm{ext}} + \mathcal{Q}, \qquad \mathcal{P}_{\mathrm{ext}} = \int_{S_p} \rho\boldsymbol{b}\cdot\boldsymbol{v}\,\mathrm{d}v + \int_{\partial S_p} \boldsymbol{t}\cdot\boldsymbol{v}\,\mathrm{d}a, \qquad \mathcal{Q} = \int_{S_p} \rho r\,\mathrm{d}v - \int_{\partial S_p} \boldsymbol{q}\cdot\hat{\boldsymbol{n}}\,\mathrm{d}a.$$

Applying the divergence theorem to the traction term of $\mathcal{P}_{\mathrm{ext}}$,

$$\int_{\partial S_p} \boldsymbol{t}\cdot\boldsymbol{v}\,\mathrm{d}a = \int_{\partial S_p} (\boldsymbol{\sigma}\cdot\hat{\boldsymbol{n}})\cdot\boldsymbol{v}\,\mathrm{d}a = \int_{S_p} \big[(\nabla\cdot\boldsymbol{\sigma})\cdot\boldsymbol{v} + \boldsymbol{\sigma} : \boldsymbol{L}\big]\,\mathrm{d}v.$$

Using $\nabla\cdot\boldsymbol{\sigma} + \rho\boldsymbol{b} = \rho\boldsymbol{a}$ and the closed-system identity (3),

$$\mathcal{P}_{\mathrm{ext}} = \int_{S_p} \rho\boldsymbol{a}\cdot\boldsymbol{v}\,\mathrm{d}v + \int_{S_p} \boldsymbol{\sigma} : \boldsymbol{L}\,\mathrm{d}v = \dot{K} + \int_{S_p} \boldsymbol{\sigma} : \boldsymbol{D}\,\mathrm{d}v,$$

where $\boldsymbol{D} = \frac{1}{2}(\boldsymbol{L} + \boldsymbol{L}^{\mathrm{T}})$ is the symmetric part of the velocity gradient (the stress power uses $\boldsymbol{D}$ rather than $\boldsymbol{L}$ because $\boldsymbol{\sigma}$ is symmetric, Equation (15), and contracts to zero against the skew part of $\boldsymbol{L}$).

## 6.1 Theorem of Expended Power

**Theorem 6.1 — Theorem of Expended Power.** Define the stress power $\mathcal{P}_{\mathrm{int}} = \int_{S_p} \boldsymbol{\sigma} : \boldsymbol{D}\,\mathrm{d}v$. Then

$$\mathcal{P}_{\mathrm{ext}} = \dot{K} + \mathcal{P}_{\mathrm{int}}.$$

The total mechanical power due to the externally applied forces equals the rate of change of kinetic energy plus the stress power of the cut-out $S_p$.

## 6.2 Localisation: The Local Energy Equation

Substituting $\mathcal{P}_{\mathrm{ext}} = \dot{K} + \mathcal{P}_{\mathrm{int}}$ into the first law (17) and $\dot{\mathcal{E}}_{S_p} = \dot{K} + \dot{U}$ cancels $\dot{K}$ from both sides:

$$\dot{U} = \mathcal{P}_{\mathrm{int}} + \mathcal{Q}, \qquad \text{i.e.} \qquad \frac{\mathrm{d}}{\mathrm{d}t}\int_{S_p} \rho e\,\mathrm{d}v = \int_{S_p} \boldsymbol{\sigma} : \boldsymbol{D}\,\mathrm{d}v + \int_{S_p} \rho r\,\mathrm{d}v - \int_{\partial S_p} \boldsymbol{q}\cdot\hat{\boldsymbol{n}}\,\mathrm{d}a.$$

This is the decoupling of the mechanical and thermal power into their associated counterparts (internal energy and stress power/heat, respectively) — i.e. the conservation of energy, thermal and mechanical. Applying the closed-system identity to the left side and the divergence theorem to the heat-flux term, then localising over the arbitrary cut $S_p$, gives the local form of energy balance:

$$\rho\dot{e} = \boldsymbol{\sigma} : \boldsymbol{D} - \nabla\cdot\boldsymbol{q} + \rho r.$$
