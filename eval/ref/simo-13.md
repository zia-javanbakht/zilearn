problem

$$L(\tilde{\boldsymbol{\varepsilon}}^h, \boldsymbol{\sigma}^h) = \underset{(\tilde{\boldsymbol{\gamma}}^h, \boldsymbol{\tau}^h) \in \tilde{\mathcal{E}}^h \times S^h}{\mathrm{MIN}} [L(\tilde{\boldsymbol{\gamma}}^h, \boldsymbol{\tau}^h)] \tag{50}$$

defines the enhanced strain and stress fields $(\tilde{\boldsymbol{\varepsilon}}^h, \boldsymbol{\sigma}^h) \in \tilde{\mathcal{E}}^h \times S^h$. To see this, observe that the first variation of $L(\tilde{\boldsymbol{\varepsilon}}, \boldsymbol{\sigma})$ yields the variational equations

$$\left.\begin{aligned} &\int_{\mathcal{B}} \tilde{\boldsymbol{\gamma}}^h \cdot \mathbf{C}[\nabla^s \mathbf{u}^h + \tilde{\boldsymbol{\varepsilon}}^h] \, \mathrm{d}V = 0 \\ &\int_{\mathcal{B}} \boldsymbol{\tau}^h \cdot [\mathbf{C}^{-1} \boldsymbol{\sigma}^h - \nabla^s \mathbf{u}^h] \, \mathrm{d}V = 0 \end{aligned}\right\} \tag{51}$$

for all $(\tilde{\boldsymbol{\gamma}}^h, \boldsymbol{\tau}^h) \in \tilde{\mathcal{E}}^h \times S^h$, where we have made use of the orthogonality condition (20). Substitution into (51) of the interpolations (14) and (16) for displacement and enhanced strain fields, respectively, yields $(34)_2$ which is the linear version of equations $(22)_2$ and gives, therefore, the correct values of the enhanced strain parameters $\boldsymbol{\alpha}_e$. The new information leading to the recovery of the stress field $\boldsymbol{\sigma}^h \in S^h$ is provided by $(51)_1$.

*3.3.2. Stress recovery.* We consider a *subspace* $S_0^h \subset S^h$ of the admissible stresses defined as

$$S_0^h = \{\boldsymbol{\tau}^h \in S^h \mid \boldsymbol{\tau}^h = \boldsymbol{\tau}_e(\boldsymbol{\xi}) \chi_e \text{ with } \boldsymbol{\tau}_e(\boldsymbol{\xi}) = \mathbf{G}_\sigma(\boldsymbol{\xi}) \boldsymbol{\eta}_e\} \tag{52}$$

Here, $\mathbf{G}_\sigma(\boldsymbol{\xi})$ is a matrix of functions whose $n_\sigma$ columns are linearly independent, and such that $S_0^h$ satisfies conditions (i), (ii) and (iii) above. Substitution of (52) into (51) yields the *optimal* stress field (in a least-square sense) in $S_0^h$ as

$$\left.\begin{aligned} \boldsymbol{\sigma}_e(\boldsymbol{\xi}) &= \mathbf{G}_\sigma(\boldsymbol{\xi}) \mathbf{H}_\sigma^{-1} \boldsymbol{\Gamma}_\sigma \mathbf{d}_e \\ \mathbf{H}_\sigma &:= \int_{\mathcal{B}_e} \mathbf{G}_\sigma^{\mathrm{T}}(\boldsymbol{\xi}) \mathbf{C}^{-1} \mathbf{G}_\sigma(\boldsymbol{\xi}) \, \mathrm{d}V \\ \boldsymbol{\Gamma}_\sigma &:= \int_{\mathcal{B}_e} \mathbf{G}_\sigma^{\mathrm{T}}(\boldsymbol{\xi}) \mathbf{B}(\boldsymbol{\xi}) \, \mathrm{d}V \end{aligned}\right\} \tag{53}$$

for all elements $e = 1, 2, \ldots, n_{\mathrm{elm}}$.

*Remark 3.2.* In particular, for $S_0^h =$ piece-wise constant functions, expression (53) yields

$$\boxed{\boldsymbol{\sigma}_0^h = \mathbf{C} \frac{1}{\mathrm{Vol}(\mathcal{B}_e)} \left[ \int_{\mathcal{B}_e} \mathbf{B} \, \mathrm{d}V \right] \mathbf{d}_e} \tag{54}$$

For Cartesian problems (as opposed to axisymmetry), expression (46) boils down to evaluation of the stresses at the centre of the element. ■

## 4. ELEMENT DESIGN: ENHANCED STRAIN FIELD INTERPOLATION

In this section we consider the reformulation of conditions (ii) and (iii) of Section 2.2.2 above in a form which leads to a systematic construction of interpolation functions $\mathbf{G}(\boldsymbol{\xi})$.

The idea is to operate in the isoparametric domain in place of the physical domain and transform the results appropriately with the Jacobian of the isoparametric map at the centre of the element. We give two illustrative and representative examples: a plane elasticity element that

<!-- header/footer: CLASS OF MIXED ASSUMED STRAIN METHODS | 1607 -->
