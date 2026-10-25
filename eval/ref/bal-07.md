<!-- header/footer: 5 -->

## 7 Balance of Entropy: The Second Law of Thermodynamics

The first law of thermodynamics indicates the balance of energy but does not place a restriction on the direction of the process. In heat transfer, the preferred direction of the spontaneous heat flow between two systems at distinct temperatures is from the warmer system to the colder one. Thus, there is a preferred direction, and this limitation is generalised and mathematically expressed as an inequality: the internal entropy production is always non-negative, and it is positive for an irreversible process. Entropy is a measure of disorder, work conjugate to temperature (like stress and strain).

**Definition 7.1 — Entropy Balance.** Let $\eta(\boldsymbol{x}, t)$ be the mass-specific entropy density and $\theta(\boldsymbol{x}, t) > 0$ the absolute temperature. The total entropy of the sub-body $S_p$ is $H_{S_p} = \int_{S_p} \rho\eta\,\mathrm{d}v$. The second law states that the rate of entropy increase in $S_p$ is bounded below by the entropy input rate $\dot{\Sigma}_{S_p}$, with an internal heat source $r$:

$$\dot{H}_{S_p} \geq \dot{\Sigma}_{S_p}, \qquad \dot{\Sigma}_{S_p} = \int_{S_p} \frac{\rho r}{\theta}\,\mathrm{d}v - \int_{\partial S_p} \frac{\boldsymbol{q}\cdot\hat{\boldsymbol{n}}}{\theta}\,\mathrm{d}a.$$

The total rate of entropy production within the sub-body $S_p$ is $\Gamma = \frac{\mathrm{d}}{\mathrm{d}t}\int_{S_p} \rho\eta\,\mathrm{d}v - \dot{\Sigma}_{S_p} \geq 0$. Applying the closed-system identity to $\dot{H}_{S_p}$ and expanding the divergence term using $\nabla\cdot(\boldsymbol{q}/\theta) = \nabla\cdot\boldsymbol{q}/\theta - \boldsymbol{q}\cdot\nabla\theta/\theta^2$:

$$\int_{S_p} \rho\dot{\eta}\,\mathrm{d}v \geq \int_{S_p} \frac{\rho r}{\theta}\,\mathrm{d}v - \int_{S_p} \frac{\nabla\cdot\boldsymbol{q}}{\theta}\,\mathrm{d}v + \int_{S_p} \frac{\boldsymbol{q}\cdot\nabla\theta}{\theta^2}\,\mathrm{d}v.$$

Localising over the arbitrary cut $S_p$ gives the local **Clausius–Duhem inequality**:

$$\rho\dot{\eta} \geq \frac{\rho r}{\theta} - \frac{\nabla\cdot\boldsymbol{q}}{\theta} + \frac{\boldsymbol{q}\cdot\nabla\theta}{\theta^2}.$$
