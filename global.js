console.log("IT'S ALIVE!");

function $$(selector, context = document) {
  return Array.from(context.querySelectorAll(selector));
}

function normalizePath(path) {
  return path.replace(/index\.html$/, "").replace(/\/$/, "");
}

const siteRoot = new URL("./", import.meta.url);

const pages = [
  { url: "", title: "Home" },
  { url: "projects/", title: "Projects" },
  { url: "resume/", title: "Resume" },
  { url: "contact/", title: "Contact" },
  { url: "https://github.com/jaceyccy", title: "GitHub ↗" },
];

const nav = document.createElement("nav");
nav.setAttribute("aria-label", "Main navigation");

document.querySelector(".site-header").append(nav);

for (const page of pages) {
  const link = document.createElement("a");

  link.href = new URL(page.url, siteRoot).href;
  link.textContent = page.title;

  const isCurrentPage =
    link.host === location.host &&
    normalizePath(link.pathname) === normalizePath(location.pathname);

  if (isCurrentPage) {
    link.classList.add("current");
    link.setAttribute("aria-current", "page");
  }

  if (link.host !== location.host) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }

  nav.append(link);
}

document.body.insertAdjacentHTML(
    "afterbegin",
    `
    <label class="color-scheme">
      Theme:
      <select>
        <option value="light dark">Automatic</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
    `
  );

  const select = document.querySelector(".color-scheme select");

function setColorScheme(colorScheme) {
  document.documentElement.style.setProperty(
    "color-scheme",
    colorScheme
  );

  select.value = colorScheme;
}

// Restore the saved choice when a page loads.
const savedScheme = localStorage.getItem("colorScheme");

if (["light dark", "light", "dark"].includes(savedScheme)) {
  setColorScheme(savedScheme);
} else {
  setColorScheme("light dark");
}

// Update and save the choice when the dropdown changes.
select.addEventListener("input", (event) => {
  const colorScheme = event.target.value;

  setColorScheme(colorScheme);
  localStorage.setItem("colorScheme", colorScheme);
});