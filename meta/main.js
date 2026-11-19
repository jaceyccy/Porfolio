import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import scrollama from "https://cdn.jsdelivr.net/npm/scrollama@3.2.0/+esm";

// Shared state used by the chart and its interactions.
let commits = [];
let xScale;
let yScale;
let brush;
let brushGroup;

// Lab 8: time slider state.
let commitProgress = 100;
let timeScale;
let commitMaxTime;
let filteredCommits = [];

// Chart size, shared by the render and update functions.
const width = 1000;
const height = 560;
const margin = { top: 20, right: 25, bottom: 65, left: 75 };
const plot = {
  left: margin.left,
  right: width - margin.right,
  top: margin.top,
  bottom: height - margin.bottom,
};

const tooltip = document.querySelector("#commit-tooltip");
const integer = d3.format(",d");

// Read the CSV and convert strings into numbers and dates.
async function loadData() {
  return d3.csv("./loc.csv", (row) => ({
    ...row,
    line: Number(row.line),
    depth: Number(row.depth),
    length: Number(row.length),
    date: new Date(`${row.date}T00:00:00${row.timezone}`),
    datetime: new Date(row.datetime),
  }));
}

// Turn groups of lines into one object per commit.
function processCommits(data) {
  return d3.groups(data, (row) => row.commit).map(([id, lines]) => {
    const first = lines[0];

    const commit = {
      id,
      url: `https://github.com/jaceyccy/Porfolio/commit/${id}`,
      author: first.author,
      date: first.date,
      time: first.time,
      timezone: first.timezone,
      datetime: first.datetime,
      hourFrac:
        first.datetime.getHours() +
        first.datetime.getMinutes() / 60 +
        first.datetime.getSeconds() / 3600,
      totalLines: lines.length,
    };

    // Keep the original lines available for the language breakdown.
    Object.defineProperty(commit, "lines", {
      value: lines,
      enumerable: false,
      writable: false,
      configurable: false,
    });

    return commit;
  })
    // Lab 8: oldest first, so the scrolling story runs in order.
    .sort((a, b) => a.datetime - b.datetime);
}

// Display six summary statistics.
function renderStats(data) {
  const values = [
    ["Lines of code", integer(data.length)],
    ["Commits represented", integer(commits.length)],
    ["Files", integer(d3.group(data, (row) => row.file).size)],
    ["Average line length", d3.format(".1f")(d3.mean(data, (row) => row.length))],
    ["Longest line", integer(d3.max(data, (row) => row.length))],
    ["Maximum depth", integer(d3.max(data, (row) => row.depth))],
  ];

  const container = d3.select("#stats");
  container.selectAll("*").remove();

  const list = container.append("dl").attr("class", "meta-stats");

  for (const [label, value] of values) {
    const item = list.append("div");
    item.append("dt").text(label);
    item.append("dd").text(value);
  }
}

// Fill the tooltip with information about one commit.
function renderTooltipContent(commit) {
  const link = document.querySelector("#commit-link");

  link.href = commit.url;
  link.textContent = commit.id.slice(0, 7);

  document.querySelector("#commit-date").textContent =
    commit.datetime.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  document.querySelector("#commit-tooltip-time").textContent =
    commit.datetime.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });

  document.querySelector("#commit-author").textContent = commit.author;

  document.querySelector("#commit-lines").textContent =
    integer(commit.totalLines);
}

// Keep the tooltip near the pointer and inside the viewport.
function positionTooltip(event) {
  const gap = 12;
  const bounds = tooltip.getBoundingClientRect();

  let left = event.clientX + gap;
  let top = event.clientY + gap;

  if (left + bounds.width > window.innerWidth - gap) {
    left = event.clientX - bounds.width - gap;
  }

  if (top + bounds.height > window.innerHeight - gap) {
    top = event.clientY - bounds.height - gap;
  }

  tooltip.style.left = `${Math.max(gap, left)}px`;
  tooltip.style.top = `${Math.max(gap, top)}px`;
}

function showTooltip(event, commit) {
  renderTooltipContent(commit);
  tooltip.hidden = false;
  positionTooltip(event);
}

function hideTooltip() {
  tooltip.hidden = true;
}

// Check whether a circle's center is inside the brush rectangle.
function isCommitSelected(selection, commit) {
  if (!selection) return false;

  const [[left, top], [right, bottom]] = selection;
  const x = xScale(commit.datetime);
  const y = yScale(commit.hourFrac);

  return x >= left && x <= right && y >= top && y <= bottom;
}

// Display line counts and percentages for selected languages.
function renderLanguageBreakdown(selectedCommits) {
  const container = d3.select("#language-breakdown");
  container.selectAll("*").remove();

  document.querySelector("#language-hint").hidden =
    selectedCommits.length > 0;

  if (selectedCommits.length === 0) return;

  const lines = selectedCommits.flatMap((commit) => commit.lines);

  const counts = d3.rollups(
    lines,
    (rows) => rows.length,
    (row) => row.type,
  );

  counts.sort((a, b) => d3.descending(a[1], b[1]));

  for (const [language, count] of counts) {
    const item = container.append("div");

    item.append("dt").text(language);

    item.append("dd").text(
      `${integer(count)} lines (${d3.format(".1%")(count / lines.length)})`,
    );
  }
}

// Update the circles, count, and breakdown whenever brushing changes.
function brushed(event) {
  const selection = event.selection;

  // Only commits visible under the time slider can be selected.
  const selectedCommits = filteredCommits.filter((commit) =>
    isCommitSelected(selection, commit),
  );

  d3.select("#chart")
    .selectAll(".dots circle")
    .classed("selected", (commit) =>
      isCommitSelected(selection, commit),
    );

  const count = selectedCommits.length;

  document.querySelector("#selection-count").textContent =
    count === 0
      ? "No commits selected"
      : `${integer(count)} commit${count === 1 ? "" : "s"} selected`;

  renderLanguageBreakdown(selectedCommits);
}

// Pick an x-axis domain for the visible commits.
function getDateDomain(commitsToShow) {
  let [firstDate, lastDate] = d3.extent(
    commitsToShow,
    (commit) => commit.datetime,
  );

  // Give a one-commit (or one-moment) range a usable width.
  if (+firstDate === +lastDate) {
    firstDate = d3.timeDay.offset(firstDate, -1);
    lastDate = d3.timeDay.offset(lastDate, 1);
  }

  return [firstDate, lastDate];
}

// Build the parts of the scatterplot that never change: the SVG,
// gridlines, axis groups, labels, brush, and the dots group.
function renderScatterPlot(commitsToShow) {
  const svg = d3.select("#chart")
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "group")
    .attr("aria-label", "Commit dates and times, with draggable selection");

  xScale = d3.scaleTime()
    .domain(getDateDomain(commitsToShow))
    .range([plot.left, plot.right])
    .nice();

  yScale = d3.scaleLinear()
    .domain([0, 24])
    .range([plot.bottom, plot.top]);

  const hours = d3.range(0, 25, 3);

  // Gridlines go behind the other chart elements.
  svg.append("g")
    .attr("class", "gridlines")
    .attr("transform", `translate(${plot.left}, 0)`)
    .call(
      d3.axisLeft(yScale)
        .tickValues(hours)
        .tickFormat(() => "")
        .tickSize(-(plot.right - plot.left)),
    )
    .call((group) => group.select(".domain").remove());

  // The x-axis gets a class so updateScatterPlot can find and redraw it.
  svg.append("g")
    .attr("class", "axis x-axis")
    .attr("transform", `translate(0, ${plot.bottom})`)
    .call(d3.axisBottom(xScale).ticks(6));

  svg.append("g")
    .attr("class", "axis y-axis")
    .attr("transform", `translate(${plot.left}, 0)`)
    .call(
      d3.axisLeft(yScale)
        .tickValues(hours)
        .tickFormat((hour) =>
          `${String(hour).padStart(2, "0")}:00`,
        ),
    );

  svg.append("text")
    .attr("class", "axis-label")
    .attr("x", (plot.left + plot.right) / 2)
    .attr("y", height - 12)
    .attr("text-anchor", "middle")
    .text("Commit date");

  svg.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -(plot.top + plot.bottom) / 2)
    .attr("y", 19)
    .attr("text-anchor", "middle")
    .text("Time of day");

  // Add the brush BEFORE the circles so circles still receive hover.
  brush = d3.brush()
    .extent([
      [plot.left, plot.top],
      [plot.right, plot.bottom],
    ])
    .on("start brush end", brushed);

  brushGroup = svg.append("g")
    .attr("class", "brush")
    .call(brush);

  svg.append("g").attr("class", "dots");

  updateScatterPlot(commitsToShow);
}

// Redraw the x-axis and circles for a new set of commits, reusing
// the existing SVG instead of appending another one.
function updateScatterPlot(commitsToShow) {
  const svg = d3.select("#chart svg");

  xScale.domain(getDateDomain(commitsToShow)).nice();

  // Starting both domains at zero makes area proportional to count.
  const radiusScale = d3.scaleSqrt()
    .domain([0, d3.max(commitsToShow, (commit) => commit.totalLines)])
    .range([0, 28]);

  const xAxis = d3.axisBottom(xScale).ticks(6);

  const xAxisGroup = svg.select("g.x-axis");
  xAxisGroup.selectAll("*").remove();
  xAxisGroup.call(xAxis);

  // Draw larger circles first, leaving smaller circles on top.
  const sortedCommits = [...commitsToShow].sort(
    (a, b) => b.totalLines - a.totalLines,
  );

  svg.select("g.dots")
    .selectAll("circle")
    // Key by commit id so each circle stays tied to the same commit.
    .data(sortedCommits, (commit) => commit.id)
    .join("circle")
    .attr("cx", (commit) => xScale(commit.datetime))
    .attr("cy", (commit) => yScale(commit.hourFrac))
    .attr("r", (commit) => radiusScale(commit.totalLines))
    // --r lets CSS make larger circles take longer to grow in.
    .style("--r", (commit) => radiusScale(commit.totalLines))
    .attr("tabindex", 0)
    .attr("role", "link")
    .attr("aria-label", (commit) =>
      `Commit ${commit.id.slice(0, 7)} by ${commit.author}, ` +
      `${commit.datetime.toLocaleString()}, ` +
      `${commit.totalLines} lines. Open on GitHub.`,
    )
    .on("mouseenter", showTooltip)
    .on("mousemove", positionTooltip)
    .on("mouseleave", hideTooltip)
    .on("focus", (event, commit) => {
      const bounds = event.currentTarget.getBoundingClientRect();

      showTooltip(
        { clientX: bounds.right, clientY: bounds.top },
        commit,
      );
    })
    .on("blur", hideTooltip)
    .on("click", (event, commit) => {
      window.open(commit.url, "_blank", "noopener,noreferrer");
    })
    .on("keydown", (event, commit) => {
      if (event.key === "Enter") {
        window.open(commit.url, "_blank", "noopener,noreferrer");
      }

      if (event.key === "Escape") {
        hideTooltip();
      }
    });

  // The axis moved, so an old brush rectangle no longer matches the
  // same commits. Clear it (this also resets the selection count).
  brushGroup.call(brush.move, null);
}

// Lab 8 Step 2: one color per technology (html, css, js, ...).
const colors = d3.scaleOrdinal(d3.schemeTableau10);

// Lab 8 Step 2: unit visualization with one dot per line, grouped by file.
function updateFileDisplay(commitsToShow) {
  const lines = commitsToShow.flatMap((commit) => commit.lines);

  const files = d3
    .groups(lines, (line) => line.file)
    .map(([name, lines]) => ({ name, lines }))
    .sort((a, b) => b.lines.length - a.lines.length);

  // Key by file name so each row stays tied to the same file.
  const filesContainer = d3
    .select("#files")
    .selectAll("div")
    .data(files, (file) => file.name)
    .join((enter) =>
      enter.append("div").call((div) => {
        div.append("dt");
        div.append("dd");
      }),
    );

  // join() keeps DOM order from the first render, so re-sort it.
  filesContainer.order();

  filesContainer
    .select("dt")
    .html(
      (file) =>
        `<code>${file.name}</code>` +
        `<small>${integer(file.lines.length)} lines</small>`,
    );

  filesContainer
    .select("dd")
    .selectAll("div")
    .data((file) => file.lines)
    .join("div")
    .attr("class", "loc")
    .attr("style", (line) => `--color: ${colors(line.type)}`);
}

// Lab 8 Step 1: filter commits by the time slider.
function onTimeSliderChange() {
  const slider = document.querySelector("#commit-progress");

  commitProgress = Number(slider.value);
  updateForTime(timeScale.invert(commitProgress));
}

// Show every commit up to maxTime. Shared by the slider and scrolling.
function updateForTime(maxTime) {
  commitMaxTime = maxTime;

  document.querySelector("#commit-time").textContent =
    commitMaxTime.toLocaleString(undefined, {
      dateStyle: "long",
      timeStyle: "short",
    });

  filteredCommits = commits.filter(
    (commit) => commit.datetime <= commitMaxTime,
  );

  updateScatterPlot(filteredCommits);
  updateFileDisplay(filteredCommits);
}

// Lab 8 Step 3.2: one paragraph of story text per commit.
function renderStory() {
  d3.select("#scatter-story")
    .selectAll(".step")
    .data(commits)
    .join("div")
    .attr("class", "step")
    .html((commit, index) => {
      const fileCount = d3.rollups(
        commit.lines,
        (lines) => lines.length,
        (line) => line.file,
      ).length;

      const date = commit.datetime.toLocaleString("en", {
        dateStyle: "full",
        timeStyle: "short",
      });

      const which =
        index === 0
          ? "I made my first commit, and it was glorious"
          : "I made another glorious commit";

      return `
        <p>
          On ${date},
          <a href="${commit.url}" target="_blank" rel="noopener noreferrer">
            ${which}</a>.
          I edited ${integer(commit.totalLines)}
          line${commit.totalLines === 1 ? "" : "s"} across
          ${integer(fileCount)} file${fileCount === 1 ? "" : "s"}.
          Then I looked over all I had made, and I saw that it was very good.
        </p>
      `;
    });
}

// Lab 8 Step 3.3: when a story step scrolls into view, show the
// portfolio as it was at that commit.
function onStepEnter(response) {
  const commit = response.element.__data__;

  // Keep the slider in sync with the story.
  commitProgress = timeScale(commit.datetime);
  document.querySelector("#commit-progress").value = commitProgress;

  updateForTime(commit.datetime);
}

function setUpScrolling() {
  const scroller = scrollama();

  scroller
    .setup({
      container: "#scrolly-1",
      step: "#scrolly-1 .step",
    })
    .onStepEnter(onStepEnter);

  // Recalculate trigger positions if the layout changes size.
  window.addEventListener("resize", () => scroller.resize());
}

// Load once, then render the page.
async function init() {
  const status = document.querySelector("#meta-status");

  try {
    const data = await loadData();

    if (data.length === 0) {
      status.textContent =
        "No data found. Generate meta/loc.csv, then refresh.";
      return;
    }

    commits = processCommits(data);
    filteredCommits = commits;

    // Map slider positions 0–100 onto the first and last commit times.
    timeScale = d3.scaleTime()
      .domain([
        d3.min(commits, (commit) => commit.datetime),
        d3.max(commits, (commit) => commit.datetime),
      ])
      .range([0, 100]);

    renderStats(data);
    renderScatterPlot(commits);

    document.querySelector("#commit-progress")
      .addEventListener("input", onTimeSliderChange);
    onTimeSliderChange();

    renderStory();
    setUpScrolling();

    document.querySelector("#clear-selection")
      .addEventListener("click", () => {
        brushGroup.call(brush.move, null);
        hideTooltip();
      });

    status.hidden = true;
  } catch (error) {
    console.error("Unable to load the Meta page:", error);

    status.textContent =
      "Unable to load commit data. Check that meta/loc.csv exists " +
      "and open this page through Live Server.";
  }
}

init();
