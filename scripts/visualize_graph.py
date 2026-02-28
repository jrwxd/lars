import json
import networkx as nx
import matplotlib.pyplot as plt

def main():
    try:
        with open('edges.json', 'r') as f:
            edges_data = json.load(f)
    except FileNotFoundError:
        print("edges.json not found.")
        return

    G = nx.DiGraph()

    for source, target in edges_data.items():
        # Keep node labels short for visualization if needed, or leave blank to show pure topology
        G.add_edge(source[:10] + "...", target[:10] + "...")

    plt.figure(figsize=(16, 12))
    
    # Use spring layout for organic structural visualization
    pos = nx.spring_layout(G, k=0.15, iterations=50)

    # Calculate degrees for node sizing/coloring
    degrees = dict(G.degree())
    node_sizes = [v * 20 + 20 for v in degrees.values()]
    
    # Identify sinks/loops
    node_colors = []
    for node in G.nodes():
        if G.out_degree(node) == 0:
            node_colors.append('red') # Dead ends
        elif G.in_degree(node) > 1:
            node_colors.append('orange') # Convergence nodes
        else:
            node_colors.append('skyblue') # Normal path

    nx.draw_networkx_nodes(G, pos, node_size=node_sizes, node_color=node_colors, alpha=0.8)
    nx.draw_networkx_edges(G, pos, arrowstyle='->', arrowsize=10, edge_color='gray', alpha=0.5)

    plt.title("Lars CA Hexagonal State Space graph (1000 nodes)", fontsize=16)
    plt.axis('off')
    
    # Save the output image
    output_path = 'state_graph_1000.png'
    plt.savefig(output_path, dpi=150, bbox_inches='tight', format='png')
    print(f"Graph visualization saved to {output_path}")

if __name__ == "__main__":
    main()
