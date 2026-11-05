import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// Shared state used by the chart and its interactions.
let commits = [];
let xScale;
let yScale;
let brush;
let brushGroup;

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
  });
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

  document.querySelector("#commit-time").textContent =
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

  const selectedCommits = commits.filter((commit) =>
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

// Build the scatterplot.
function renderScatterPlot() {
  const width = 1000;
  const height = 560;

  const margin = {
    top: 20,
    right: 25,
    bottom: 65,
    left: 75,
  };

  const plot = {
    left: margin.left,
    right: width - margin.right,
    top: margin.top,
    bottom: height - margin.bottom,
  };

  const svg = d3.select("#chart")
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "group")
    .attr("aria-label", "Commit dates and times, with draggable selection");

  let [firstDate, lastDate] = d3.extent(
    commits,
    (commit) => commit.datetime,
  );

  // Give a single-commit dataset a usable horizontal range.
  if (+firstDate === +lastDate) {
    firstDate = d3.timeDay.offset(firstDate, -1);
    lastDate = d3.timeDay.offset(lastDate, 1);
  }

  xScale = d3.scaleTime()
    .domain([firstDate, lastDate])
    .range([plot.left, plot.right])
    .nice();

  yScale = d3.scaleLinear()
    .domain([0, 24])
    .range([plot.bottom, plot.top]);

  // Starting both domains at zero makes area proportional to count.
  const radiusScale = d3.scaleSqrt()
    .domain([0, d3.max(commits, (commit) => commit.totalLines)])
    .range([0, 28]);

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

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0, ${plot.bottom})`)
    .call(d3.axisBottom(xScale).ticks(6));

  svg.append("g")
    .attr("class", "axis")
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

  // Draw larger circles first, leaving smaller circles on top.
  const sortedCommits = [...commits].sort(
    (a, b) => b.totalLines - a.totalLines,
  );

  svg.append("g")
    .attr("class", "dots")
    .selectAll("circle")
    .data(sortedCommits, (commit) => commit.id)
    .join("circle")
    .attr("cx", (commit) => xScale(commit.datetime))
    .attr("cy", (commit) => yScale(commit.hourFrac))
    .attr("r", (commit) => radiusScale(commit.totalLines))
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

    renderStats(data);
    renderScatterPlot();

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