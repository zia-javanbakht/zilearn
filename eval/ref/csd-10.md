<!-- header/footer: Topic 7—Lecture Notes; Dr Zia Javanbakht; Isoparametric Elements; Natural and Physical (Local/Global) Coordinates; Definition of Jacobian Matrix; Isoparameteric vs Generic FE Flow; Mesh; Element Quality; Refinement Strategies; Convergence in Practice: $u$ vs $\sigma$; References; 6/6 -->

## Convergence in Practice: $u$ vs $\sigma$

[Figure image]

a. Log-log — power-law rates are straight lines

[Figure image]

b. Linear — same data, rates visually hidden

Figure 5. Convergence of relative error with mesh refinement: displacement $O(h^{p+1})$, one order faster than stress/force $O(h^p)$ (Hughes 2000).

**Keypoint 2.2 — Why Stress Lags Displacement.** Stress/force is a derivative of the displacement field ($\sigma = \mathbf{D}\mathbf{B}\mathbf{u}^e$) and thus differentiating drops the interpolation order by one, so its error converges one power of $h$ slower.

**Why Plot on Log-Log Axes?** On linear axes (b) both curves look flat and "converged" after a few refinements. On log-log axes (a) the same data is a straight line of slope $p$ or $p+1$ — the reliable way to read off convergence order.
