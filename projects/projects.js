import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { fetchJSON, renderProjects } from "../global.js";

const projects = await fetchJSON("../lib/projects.json");

const projectsContainer = document.querySelector(".projects");
const searchInput = document.querySelector(".searchBar");
const title = document.querySelector(".projects-title");
const status = document.querySelector("#filter-status");

const svg = d3.select("#projects-pie-plot");
const legend = d3.select(".legend");

if (!Array.isArray(projects)) {
  status.textContent = "Unable to load projects. Please try refreshing.";
} else {
  // The two filters are stored independently.
  let query = "";
  let selectedYear = null;

  // Give each year a consistent color, even after searching.
  const years = [...new Set(
    projects.map((project) => String(project.year))
  )].sort();

  const colors = d3.scaleOrdinal()
    .domain(years)
    .range(d3.schemeTableau10);

  const arcGenerator = d3.arc()
    .innerRadius(0)
    .outerRadius(50);

  const sliceGenerator = d3.pie()
    .value((group) => group.count)
    .sort(null);

  function getSearchResults() {
    return projects.filter((project) => {
      const metadata = Object.values(project)
        .join("\n")
        .toLowerCase();

      return metadata.includes(query);
    });
  }

  function renderVisibleProjects(searchResults) {
    // Apply year filtering to the search results.
    const visibleProjects = searchResults.filter((project) => {
      return selectedYear === null ||
        String(project.year) === selectedYear;
    });

    renderProjects(visibleProjects, projectsContainer, "h3");

    title.textContent = `Projects (${visibleProjects.length})`;

    const yearMessage = selectedYear === null
      ? ""
      : ` from ${selectedYear}`;

    status.textContent =
      `Showing ${visibleProjects.length} of ${projects.length}` +
      ` projects${yearMessage}.`;

    if (visibleProjects.length === 0) {
      const message = document.createElement("p");
      message.textContent =
        "No projects match. Try another search or deselect the year.";
      projectsContainer.append(message);
    }
  }

  function updateSelection() {
    svg.selectAll("path")
      .classed("selected", (slice) => {
        return slice.data.year === selectedYear;
      })
      .attr("aria-pressed", (slice) => {
        return String(slice.data.year === selectedYear);
      });

    legend.selectAll(".legend-item")
      .classed("selected", (group) => {
        return group.year === selectedYear;
      });

    legend.selectAll(".legend-button")
      .attr("aria-pressed", (group) => {
        return String(group.year === selectedYear);
      });
  }

  function toggleYear(year) {
    // Click the same year again to deselect it.
    selectedYear = selectedYear === year ? null : year;

    renderVisibleProjects(getSearchResults());
    updateSelection();
  }

  function renderPieChart(searchResults) {
    // Example: [["2024", 3], ["2025", 5], ["2026", 4]]
    const counts = d3.rollups(
      searchResults,
      (group) => group.length,
      (project) => String(project.year)
    );

    // Convert the grouped counts into named objects.
    const chartData = counts
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => d3.ascending(a.year, b.year));

    // Remove the previous chart and legend before rebuilding.
    svg.selectAll("*").remove();
    legend.selectAll("*").remove();

    const slices = sliceGenerator(chartData);

    svg.selectAll("path")
      .data(slices)
      .join("path")
      .attr("d", arcGenerator)
      .attr("fill", (slice) => colors(slice.data.year))
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (slice) => {
        return `${slice.data.year}: ${slice.data.count} projects`;
      })
      .on("click", (event, slice) => {
        toggleYear(slice.data.year);
      })
      .on("keydown", (event, slice) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleYear(slice.data.year);
        }
      })
      .append("title")
      .text((slice) => {
        return `${slice.data.year}: ${slice.data.count} projects`;
      });

    const items = legend.selectAll("li")
      .data(chartData)
      .join("li")
      .attr("class", "legend-item")
      .style("--color", (group) => colors(group.year));

    const buttons = items.append("button")
      .attr("type", "button")
      .attr("class", "legend-button")
      .on("click", (event, group) => {
        toggleYear(group.year);
      });

    buttons.append("span")
      .attr("class", "swatch")
      .attr("aria-hidden", "true");

    buttons.append("span")
      .text((group) => `${group.year} (${group.count})`);

    // Keep a selected year available for deselection even when
    // the current search has no projects from that year.
    if (
      selectedYear !== null &&
      !chartData.some((group) => group.year === selectedYear)
    ) {
      legend.append("li")
        .append("button")
        .attr("type", "button")
        .attr("class", "legend-button")
        .text(`Clear ${selectedYear} filter (0 matches)`)
        .on("click", () => {
          selectedYear = null;
          updatePage();
        });
    }

    updateSelection();
  }

  function updatePage() {
    const searchResults = getSearchResults();

    renderVisibleProjects(searchResults);
    renderPieChart(searchResults);
  }

  searchInput.addEventListener("input", (event) => {
    query = event.target.value.trim().toLowerCase();
    updatePage();
  });

  // Draw everything immediately when the page opens.
  updatePage();
}
