### B.5 When does slow loading justify quasi-static equilibrium?

*Focus: Section 8 and Appendix A.2.*

Consider the small-amplitude, unprestressed limit of the same bar, with density $\rho_0$ and modulus $K$. Its displacement satisfies

$$\rho_0 u_{tt} = K u_{XX}.$$

Let $X = L\widehat{X}$, $t = T_{\text{load}}\widehat{t}$, and $u = U\widehat{u}$. Define the wave speed $c = \sqrt{K/\rho_0}$ and the transit time $T_{\text{wave}} = L/c$.

(a) Nondimensionalize the equation. Show that the coefficient multiplying $\widehat{u}_{\widehat{t}\widehat{t}}$ is $\epsilon = (T_{\text{wave}}/T_{\text{load}})^2$.

(b) Evaluate $\epsilon$ for smooth load ramps with durations $100T_{\text{wave}}$ and $T_{\text{wave}}/10$. Which is a plausible quasi-static regime, assuming initially negligible vibrations?

(c) Distinguish a held static state, a quasi-static loading path, and a Newton iteration at a fixed load. Is the Newton index a physical time variable?

(d) A very slow loading path reaches a limit point or a snap-through instability. Explain why the preceding timescale estimate need not justify quasi-static motion through the ensuing jump. Relate this to loss of tangent stiffness.

### B.6 Finite energy and the stress–test-gradient pairing

*Focus: Section 4 and Appendix A.4.*

On the nondimensional interval $0 < X < 1$, consider the scalar model

$$\varphi(X) = \frac{X^{1-a}}{1-a}, \qquad F = \varphi'(X) = X^{-a}, \qquad \Psi(F) = \frac{F^4}{4}, \qquad P = \frac{d\Psi}{dF} = F^3, \qquad 0 < a < 1.$$

This example tests integrability; it is not claimed to solve a loaded equilibrium problem. Use $\int_0^1 X^{-q}\,\mathrm{d}X < \infty$ if and only if $q < 1$.

(a) Find the conditions on $a$ for $\varphi \in H^1(0,1)$ and for finite stored energy. Use $a = 1/3$ to show that membership in $H^1$ does not suffice.

(b) Let $\eta(X) = X^{1-b}/(1-b)$ with $0 < b < 1/4$, so $\eta(0) = 0$ and $\eta' = X^{-b} \in L^4$. For $0 < a < 1/4$, verify $P \in L^{4/3}$ and compute $\int_0^1 P\eta'\,\mathrm{d}X$ exactly.

(c) Write the Hölder estimate for this integral and evaluate both norms. Why do the conjugate exponents $4/3$ and $4$ appear?

(d) With $a = b = 1/8$, evaluate the integral and the product of norms. Are they equal? Finally, does finite energy plus $F > 0$ by itself establish the existence of an equilibrium minimizer?

<!-- header/footer: NONLINEAR SOLID MECHANICS | Strong forms, weak forms, and consistent tangents | Dr. Lonny L. Thompson, Clemson University, Sept 25, 2026. | 20 / 29 -->
