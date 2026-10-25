### 3.1. *Consistency and the patch test*

Since $\mathbf{C}$ is positive definite, the assumption of linear independence on the rows of $\mathbf{G}(\boldsymbol{\xi})$ is equivalent to the assumption that the matrix

$$\mathbf{H} := \int_{\square} \mathbf{G}^{\mathrm{T}}(\boldsymbol{\xi})\mathbf{C}\mathbf{G}(\boldsymbol{\xi})j(\boldsymbol{\xi})\, \mathrm{d}\boldsymbol{\xi} \tag{26}$$

be *positive definite*; i.e.

$$\boxed{\boldsymbol{\alpha}_e^{\mathrm{T}}\mathbf{H}\boldsymbol{\alpha}_e > 0, \quad \text{for any } \boldsymbol{\alpha}_e \in \mathbb{R}^{n_{\tilde{\varepsilon}}}} \tag{27}$$

With this observation in mind, we examine the implications of conditions (ii) and (iii) on the structure of $\mathbf{G}(\boldsymbol{\xi})$ and their relation to the patch test. Let

$$\bar{\mathbf{G}} := \int_{\square} \mathbf{G}(\boldsymbol{\xi})j(\boldsymbol{\xi})\, \mathrm{d}\boldsymbol{\xi} \tag{28}$$

where $j(\boldsymbol{\xi})$ is the Jacobian determinant of the isoparametric map. Choosing $\boldsymbol{\tau}_e^{0} = \text{constant}$, for $e = 1, 2, \ldots, n_{\mathrm{elm}}$, condition (ii) implies

$$\boldsymbol{\alpha}_e \cdot \bar{\mathbf{G}}^{\mathrm{T}}\boldsymbol{\tau}_e^{0} = 0, \quad \forall\, \boldsymbol{\alpha}_e \in \mathbb{R}^{n_{\tilde{\varepsilon}}} \Rightarrow \bar{\mathbf{G}}^{\mathrm{T}}\boldsymbol{\tau}_e^{0} = \mathbf{0} \tag{29}$$

Now, condition (iii) on $S^{h}$ requires that *any* piece-wise constant stress be in $S^{h}$. Consequently, (29) must *hold for any* $\boldsymbol{\tau}_e^{0} \in \mathbb{R}^{n_{\mathrm{sym}}}$; and we have

$$\boxed{\bar{\mathbf{G}}^{\mathrm{T}}\boldsymbol{\tau}_e^{0} = \mathbf{0}, \quad \forall\, \boldsymbol{\tau}_e^{0} \in \mathbb{R}^{n_{\mathrm{sym}}}} \tag{30}$$

We show that conditions (27) and (30) do, in fact, imply satisfaction of the patch test. In particular, (30) is satisfied if $\bar{\mathbf{G}} = 0$, a condition set forth in Taylor *et al.*$^{22}$

#### 3.1.1. *The patch test.*

Consider a nodal displacement vector $\mathbf{d}$, such that

$$\boldsymbol{\sigma}_e^{0} := \mathbf{C}\mathbf{B}\mathbf{d}_e \equiv \text{constant} \tag{31}$$

for $e = 1, 2, \ldots, n_{\mathrm{elm}}$. Then, equation $(22)_2$ gives

$$\begin{aligned} \mathbf{h}_e &:= \int_{\square} \mathbf{G}^{\mathrm{T}}[\mathbf{C}\mathbf{B}\mathbf{d}_e]\, j(\boldsymbol{\xi})\, \mathrm{d}\boldsymbol{\xi} + \mathbf{H}\boldsymbol{\alpha}_e \\ &= \bar{\mathbf{G}}^{\mathrm{T}}\boldsymbol{\sigma}_e^{0} + \mathbf{H}\boldsymbol{\alpha}_e = \mathbf{0} \end{aligned} \tag{32}$$

If (27) and (30) hold, then (32) gives $\boldsymbol{\alpha}_e = \mathbf{0}$ $(e = 1, 2, \ldots, n_{\mathrm{elm}})$, and the internal force vector reduces to the standard displacement model, i.e.

$$\mathbf{f}_e^{\mathrm{int}} = \left[ \int_{\square} \mathbf{B}^{\mathrm{T}}\mathbf{C}\mathbf{B}\, j\, \mathrm{d}\boldsymbol{\xi} \right] \mathbf{d}_e \tag{33}$$

which, by construction, satisfies the patch test. Hence, conditions (27) and (30) imply satisfaction of the patch test.

<!-- header/footer: CLASS OF MIXED ASSUMED STRAIN METHODS 1603 -->
