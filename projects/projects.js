import { fetchJSON, renderProjects } from "../global.js";

const projects = await fetchJSON("../lib/projects.json");
const projectsContainer = document.querySelector(".projects");

if (projects) {
  renderProjects(projects, projectsContainer, "h2");

  const title = document.querySelector(".projects-title");
  if (title) {
    title.textContent = `Projects (${projects.length})`;
  }
}