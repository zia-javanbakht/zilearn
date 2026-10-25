[Figure image]

Figure 6. Failure strength and strain predicted by the numerical model with different RVE sizes.

## FE implementation

A composite structure consists of several RVEs that are in contact with each other, which means that the left, right, front, and back sides of an RVE are surrounded by other RVEs (see Figure 3). Thus, the displacement of nodes on each side of the RVE is controlled by that of the corresponding nodes on the parallel side. This can be simulated by applying periodic boundary conditions (PBCs) to the nodes on different sides of the RVE. It is important to note that the thickness of the RVE is the same as the thickness of the composite at the macro scale and thus PBCs are not assigned to the top and bottom sides of the RVE. To further clarify the concept behind a periodic RVE geometry, the two-dimensional surfaces of three similar RVEs stitched together are shown in Figure 4. It can be seen that the fibers on each edge of the middle RVE are complemented by those on the opposite edge and also all the fibers on the edges of the middle RVE form a complete fiber when RVEs are stitched together.

To apply the PBCs to the RVE, a displacement boundary condition, which specifies the displacement differences between each pair of nodes on parallel boundaries will be used as shown in equation (4):

$$U_i^{j+} - U_i^{j-} = \bar{\epsilon}_{ik}\left[X_k^{j+} - X_k^{j-}\right] = \bar{\epsilon}_{ik}\Delta X_k^{j}\ (i,j,k = x,y,z) \tag{4}$$

where $U_i$ is displacement in *ith* direction, $X_k^{j+}$ is the coordinates of the node and $\epsilon$ is the macro strain tensor. $j+$ and $j-$ represent the parallel boundary surfaces on opposite sides of an RVE of a composite. When an RVE is subjected to a specific strain of $\bar{\epsilon}_{ik}$, the expression $X_k^{j+} - X_k^{j-}$ remains constant for the parallel boundary surfaces, the righthand side of equation (4) will be constant. Such nodal displacement constraint is implemented in FE analysis to apply PBCs to the RVE.

Additionally, a displacement-controlled tensile load was applied to the RVE in the fiber direction. The RVE was then discretized into eight-node linear brick and reduced

<!-- header/footer: 1218 Journal of Sandwich Structures & Materials 26(7) -->
