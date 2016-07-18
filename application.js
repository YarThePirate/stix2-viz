// Copyright (c) 2016, The MITRE Corporation. All rights reserved.
// See LICENSE.txt for complete terms.


// Config
var d3Config = {
  color: d3.scale.category20(),
  nodeSize: 15,//10;
  linkMultiplier: 10//20
}

// Init some stuff
// MATT: For optimization purposes, I might look into moving these to
// local variables
selectedContainer = document.getElementById('selection');
uploader = document.getElementById('uploader');
canvasContainer = document.getElementById('canvas-container');
canvas = document.getElementById('canvas');
styles = window.getComputedStyle(uploader);
width = 900;// parseInt(styles.width) - 350;
height = 450;// parseInt(styles.height);
canvas.style.width = width;
canvas.style.height = height;

refRegex = /_ref$/;
relationshipsKeyRegex = /(r|R)elationships?/; // Added by Matt
// Determines the "float and repel" behavior of the nodes
var force = d3.layout.force().charge(-400).linkDistance(d3Config.linkMultiplier * d3Config.nodeSize).size([width, height]);
// Determines the "float and repel" behavior of the text labels
var labelForce = d3.layout.force().gravity(0).linkDistance(25).linkStrength(8).charge(-120).size([width, height]);
var svg = d3.select('svg');
var typeGroups = {};
var typeIndex = 0;

var currentGraph = {
  nodes: [],
  edges: []
}
var labelGraph = {
  nodes: [],
  edges: []
}

var idCache = {};

/* ----------------------------------------------------- *
 * ******************************************************
 * This group of functions is for handling file "upload."
 * They take an event as input and parse the file on the
 * front end.
 * ******************************************************/
function handleFileSelect(evt) {
  handleFiles(evt.target.files);
}
function handleFileDrop(evt) {
  evt.stopPropagation();
  evt.preventDefault();

  handleFiles(evt.dataTransfer.files);
}
function handleDragOver(evt) {
  evt.stopPropagation();
  evt.preventDefault();
  evt.dataTransfer.dropEffect = 'copy'; // Explicitly show this is a copy.
}
function handleFiles(files) {
  // files is a FileList of File objects (in our case, just one)
  for (var i = 0, f; f = files[i]; i++) {
    document.getElementById('chosen-files').innerText += f.name + " ";
    hideMessages();

    var r = new FileReader();
    r.onload = function(e) {addToGraph(JSON.parse(e.target.result))};
    r.readAsText(f);
  }
}
/* ---------------------------------------------------- */

/* ******************************************************
 * Handles content pasted to the text area.
 * ******************************************************/
function handleTextarea() {
  content = document.getElementById('paste-area').value;
  handlePackage(content);
}

/* ******************************************************
 * Fetches STIX 2.0 data from an external URL (supplied
 * user) via AJAX. Server-side Access-Control-Allow-Origin
 * must allow cross-domain requests for this to work.
 * ******************************************************/
function handleFetchJson() {
  var url = document.getElementById("url").value;
  fetchJsonAjax(url, handlePackage);
}

/* ******************************************************
 * Attempts to build and display the graph from an
 * arbitrary input string. If parsing the string does not
 * produce valid JSON, fails gracefully and alerts the user.
 * 
 * Takes a string as input.
 * ******************************************************/
function handlePackage(package) {
  try {
    var parsed = JSON.parse(package); // Saving this to a variable stops the rest of the function from executing on parse failure
    hideMessages();
    addToGraph(parsed);
  } catch (err) {
    alert("Something went wrong!\n\nError:\n" + err);
  }
}

function addToGraph(package) {
  // Turn header into a "home" "link"
  var header = document.getElementById('header');
  header.classList.add('linkish');

  buildNodes(package);
  buildLegend();
  initGraph();
}

/* ******************************************************
 * Generates the components on the chart from the JSON data
 * ******************************************************/
function initGraph() {
  force.nodes(currentGraph.nodes).links(currentGraph.edges).start();
  labelForce.nodes(labelGraph.nodes).links(labelGraph.edges).start();

  // build the arrow.
  // (Only builds one arrow which is then referenced by the marker-end
  // attribute of the lines)
  // code shamelessly cribbed from: http://stackoverflow.com/questions/28050434/introducing-arrowdirected-in-force-directed-graph-d3
  var defs = svg.append("svg:defs");
  defs.selectAll("marker")
      .data(["end"])      // Different link/path types can be defined here
    .enter().append("svg:marker")    // This section adds in the arrows
      .attr("id", String)
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 15)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .style("stroke-width", 0)
    .append("svg:path")
      .attr("d", "M0,-5L10,0L0,5");

  // create filter with id #drop-shadow
  // height=130% so that the shadow is not clipped
  var filter = defs.append("filter")
      .attr("id", "drop-shadow")
      .attr("height", "200%")
      .attr("width", "200%")
      .attr("x", "-50%") // x and y have to have negative offsets to 
      .attr("y", "-50%"); // stop the edges from getting cut off
  // translate output of Gaussian blur to the right and downwards with 2px
  // store result in offsetBlur
  filter.append("feOffset")
      .attr("in", "SourceAlpha")
      .attr("dx", 0)
      .attr("dy", 0)
      .attr("result", "offOut");
  // SourceAlpha refers to opacity of graphic that this filter will be applied to
  // convolve that with a Gaussian with standard deviation 3 and store result
  // in blur
  filter.append("feGaussianBlur")
      .attr("in", "offOut")
      .attr("stdDeviation", 7)
      .attr("result", "blurOut");
  filter.append("feBlend")
      .attr("in", "SourceGraphic")
      .attr("in2", "blurOut")
      .attr("mode", "normal");

  // Add pattern elements containing the icons for the various TLOs
  defs.selectAll('pattern')
      .data(Object.keys(typeGroups)) // only build patterns for types present
    .enter().append('pattern')
      .attr('id', function(d, i) { return d + "_icon"; })
      .attr('height', '100%')
      .attr('width', '100%')
      .attr('patternContentUnits', 'objectBoundingBox')
    .append('svg:image')
      .attr('height', '1')
      .attr('width', '1')
      .attr('preserveAspectRatio', 'none')
      .attr("xlink:href", function(d) { return getImgUrl(d); })

  // Adds style directly because it wasn't getting picked up by the style sheet
  var link = svg.selectAll('path.link').data(currentGraph.edges).enter().append('path')
      .attr('class', 'link')
      .style("stroke", "#aaa")
      .style("stroke-width", "3px")
      .attr("marker-end", "url(#end)")// Add the arrow to the end of the link
      .attr('id', function(d, i) { return "link_" + i; })
      .on('click', function(d, i) { handleSelected(d, this) });

  // Create the text labels that will be attatched to the paths
  var linktext = svg.append("svg:g").selectAll("g.linklabelholder").data(currentGraph.edges);
  linktext.enter().append("g").attr("class", "linklabelholder")
     .append("text")
     .attr("class", "linklabel")
   .style("font-size", "13px")
     .attr("text-anchor", "start")
     .style("fill","#000")
   .append("textPath")
    .attr("xlink:href",function(d,i) { return "#link_" + i;})
    .attr("startOffset", "20%")
    .text(function(d) {
      return d.label;
    });

  var node = svg.selectAll("circle.node")
      .data(currentGraph.nodes)
    .enter().append("circle")
      .attr("class", "node")
      .attr("r", d3Config.nodeSize)
      .style("fill", function(d) { return getPatternUrl(d); })
      .call(force.drag); // <-- What does the "call()" function do?
  node.on('click', function(d, i) { handleSelected(d, this) }); // If they're holding shift, release

  // Fix on click/drag, unfix on double click
  force.drag().on('dragstart', function(d, i) { handlePin(d, this, true) });//d.fixed = true });
  node.on('dblclick', function(d, i) { handlePin(d, this, false) });//d.fixed = false });

  // Right click will greatly dim the node and associated edges
  // >>>>>>> Does not currently work <<<<<<<
  node.on('contextmenu', function(d) {
    if(d.dimmed) {
      d.dimmed = false; // <-- What is this? Where is this set? How does this work?
      d.attr("class", "node");
    } else {
      d.dimmed = true;
      d.attr("class", "node dimmed");
    }
  })

  var anchorNode = svg.selectAll("g.anchorNode").data(labelForce.nodes()).enter().append("svg:g").attr("class", "anchorNode");
  anchorNode.append("svg:circle").attr("r", 0).style("fill", "#FFF");
		anchorNode.append("svg:text").text(function(d, i) {
		return i % 2 == 0 ? "" : titleFor(d.node);
	}).style("fill", "#555").style("font-family", "Arial").style("font-size", 12);

  // Code in the "tick" function determines where the elements
  // should be redrawn every cycle (essentially, it allows the
  // elements to be animated)
  force.on("tick", function() {
    
    link.attr("d", function(d) {
    var dx = d.target.x - d.source.x,
        dy = d.target.y - d.source.y;
        dr = 0; // Change this to make paths curved
    return "M" + d.source.x + "," + d.source.y + "A" + dr + "," + dr + " 0 0,1 " + d.target.x + "," + d.target.y;
    });

    node.attr("cx", function(d) { return d.x; })
        .attr("cy", function(d) { return d.y; });

    anchorNode.each(function(d, i) {
      labelForce.start();
			if(i % 2 == 0) {
				d.x = d.node.x;
				d.y = d.node.y;
			} else {
				var b = this.childNodes[1].getBBox();

				var diffX = d.x - d.node.x;
				var diffY = d.y - d.node.y;

				var dist = Math.sqrt(diffX * diffX + diffY * diffY);

				var shiftX = b.width * (diffX - dist) / (dist * 2);
				shiftX = Math.max(-b.width, Math.min(0, shiftX));
				var shiftY = 5;
				this.childNodes[1].setAttribute("transform", "translate(" + shiftX + "," + shiftY + ")");
			}
		});

    anchorNode.call(function() {
			this.attr("transform", function(d) {
				return "translate(" + d.x + "," + d.y + ")";
			});
		}); 
  });
}

/* ******************************************************
 * Adds class "selected" to last graph element clicked
 * and removes it from all other elements.
 *
 * Takes datum and element as input.
 * ******************************************************/
function handleSelected(d, el) {
  jsonString = JSON.stringify(d, replacer, 2); // get only the STIX values
  purified = JSON.parse(jsonString); // make a new JSON object from the STIX values
  
  // Remove old values from HTML
  selectedContainer.innerHTML = "";
  
  var counter = 0;
  
  Object.keys(purified).forEach(function(key) { // Make new HTML elements and display them
    var keyString = key;
    if (refRegex.exec(key)) { // key is "created_by_ref"... let's pretty that up
      keyString = key.replace(/_(ref)?/g, " ").trim();
    }
    keyString += ":";
    
    // Create new, empty HTML elements to be filled and injected
    var div = document.createElement('div');
    var type = document.createElement('div');
    var val = document.createElement('div');
    
    // Assign classes for proper styling
    if ((counter % 2) != 0) {
      div.classList.add("odd"); // every other row will have a grey background
    }
    type.classList.add("type");
    val.classList.add("value");

    // Some of the potential values are not very readable (IDs
    // and object references). Let's see if we can fix that.
    var value = purified[key];
    // Lots of assumptions being made about the structure of the JSON here...
    if (typeof(value) === 'object') {
      value = value.title;
    } else if (/--/.exec(value) && !(keyString === "id:")) {
      if (!(idCache[value] === null || idCache[value] === undefined)) {
        value = currentGraph.nodes[idCache[value]].title; // IDs are gross, so let's display something more readable if we can (unless it's actually the node id)
      }
    }

    // Add the text to the new inner html elements
    type.innerText = keyString;
    val.innerText = value;
    
    // Add new divs to "Selected Node"
    div.appendChild(type);
    div.appendChild(val);
    selectedContainer.appendChild(div);

    // increment the class counter
    counter += 1;
  });

  d3.select('.selected').classed('selected', false);
  d3.select(el).classed('selected', true);
}

/* ******************************************************
 * Handles pinning and unpinning of nodes.
 *
 * Takes datum, element, and boolean as input.
 * ******************************************************/
function handlePin(d, el, pinBool) {
  d.fixed = pinBool;
  d3.select(el).classed("pinned", pinBool);
}

/* ******************************************************
 * Returns the icon URL for a given string.
 * (Assumes the string represents a valid STIX item)
 * ******************************************************/
function getImgUrl(item) {
  var imgBaseString = "icons/stix2_$_icon_tiny_round_v1_fill.png";
  return imgBaseString.replace('$', item).replace('-', '_');
}

/* ******************************************************
 * Returns the URL for the SVG element containing the
 * icon for a given type of TLO.
 * 
 * Makes assumptions about the structure of the JSON data
 * ******************************************************/
function getPatternUrl(item) {
  if (item.type === 'information-source') {
    return d3Config.color(item.typeGroup);
  } else {
    return "url(#" + item.type + "_icon)";
  }
}

/* ******************************************************
 * Returns an array consisting of an object's values.
 * ******************************************************/
function getValues(obj) {
  var result = [];
  for (key in obj) {
    result.push(obj[key]);
  }
  return result;
}

/* ******************************************************
 * Builds the legend in the sidebar from whatever nodes
 * are present
 * ******************************************************/
function buildLegend() {
  var ul = document.getElementById('legend-content');
  Object.keys(typeGroups).forEach(function(typeName) {
    var li = document.createElement('li');
    var val = document.createElement('p');
    var key = document.createElement('div');
    key.style.backgroundColor = d3Config.color(typeGroups[typeName]);
    val.innerText = typeName;
    li.appendChild(key);
    li.appendChild(val);
    ul.appendChild(li);
  });
}

/* ******************************************************
 * Parses the JSON input and builds the arrays used by
 * initGraph().
 * 
 * Takes a JSON object as input.
 * ******************************************************/
function buildNodes(package) {
  var relationships = [];
  // Iterate through each key on the package. If it's an array, assume every item is a TLO.
  Object.keys(package).forEach(function(key) {
    if(package[key].constructor === Array) {
      if (!(relationshipsKeyRegex.exec(key))) { // Relationships are NOT ordinary TLOs
        parseTLOs(package[key]);
      } else {
        relationships = package[key];
      }
    }
  });

  buildRelationships(relationships);
}

/* ******************************************************
 * Adds relationships to the graph based on the array of
 * relationships contained in the data.
 * 
 * Takes an array as input.
 * ******************************************************/
function buildRelationships(relationships) {
  for(var i = 0; i < relationships.length; i++) {
    var rel = relationships[i];
    if(idCache[rel.source_ref] === null || idCache[rel.source_ref] === undefined) {
      console.error("Couldn't find source!", rel);
    } else if (idCache[rel.target_ref] === null || idCache[rel.target_ref] === undefined) {
      console.error("Couldn't find target!", rel);
    } else {
      currentGraph.edges.push({source: idCache[rel.source_ref], target: idCache[rel.target_ref], label: rel.value});
    }
  }
}

/* ******************************************************
 * Adds a title to a TLO Node
 * ******************************************************/
function titleFor(tlo) {
  if(tlo.type === 'relationship') {
    return "rel: " + (tlo.value);
  } else if (tlo.title !== undefined) {
    return tlo.title;
  } else {
    return tlo.type;
  }
}

/* ******************************************************
 * Parses valid TLOs from an array of potential TLO
 * objects (ideally from the data object)
 * 
 * Takes an array of objects as input.
 * ******************************************************/
function parseTLOs(container) {
  var cap = container.length;
  for(var i = 0; i < cap; i++) {
    // So, in theory, each of these should be a TLO. To be sure, we'll check to make sure it has an `id` and `type`. If not, raise an error and ignore it.
    var maybeTlo = container[i];
    if(maybeTlo.id === undefined || maybeTlo.type === undefined) {
      console.error("Should this be a TLO???", maybeTlo)
    } else {
      addTlo(maybeTlo);
    }
  }
}

/* ******************************************************
 * Adds a TLO node to the graph
 * 
 * Takes a valid TLO object as input.
 * ******************************************************/
function addTlo(tlo) {
  if(idCache[tlo.id]) {
    console.log("Already added, skipping!", tlo)
  } else {
    if(typeGroups[tlo.type] === undefined) {
      typeGroups[tlo.type] = typeIndex++;
    }
    tlo.typeGroup = typeGroups[tlo.type];

    idCache[tlo.id] = currentGraph.nodes.length; // Edges reference nodes by their array index, so cache the current length. When we add, it will be correct
    currentGraph.nodes.push(tlo);

    labelGraph.nodes.push({node: tlo}); // Two labels will orbit the node, we display the less crowded one and hide the more crowded one.
    labelGraph.nodes.push({node: tlo});

    labelGraph.edges.push({
			source : (labelGraph.nodes.length - 2),
			target : (labelGraph.nodes.length - 1),
      weight: 1
		});
  }
}

/* ******************************************************
 * Hides the data entry container and displays the graph
 * container
 * ******************************************************/
function hideMessages() {
  uploader.classList.toggle("hidden");
  canvasContainer.classList.toggle("hidden");
}

/* ******************************************************
 * Screens out D3 chart data from the presentation.
 * Called as the 2nd parameter to JSON.stringify().
 * ******************************************************/
function replacer(key, value) {
  var blacklist = ["typeGroup", "index", "weight", "x", "y", "px", "py", "fixed", "dimmed"];
  if (blacklist.indexOf(key) >= 0) {
    return undefined;
  }
  return value;
}

 /* ******************************************************
  * Returns the page to its original load state
  * ******************************************************/
function resetPage() {
  var header = document.getElementById('header');
  if (header.classList.contains('linkish')) {
    hideMessages();
    resetGraphVariables();
    document.getElementById('canvas').innerHTML = ""; // empty the svg
    document.getElementById('files').value = ""; // reset the files input
    document.getElementById('chosen-files').innerHTML = ""; // reset the subheader text
    document.getElementById('legend-content').innerHTML = ""; // reset the legend

    header.classList.remove('linkish');
  }
}

/* ******************************************************
 * Resets Graph variables so the graph can be rebuilt
 * *****************************************************/
function resetGraphVariables() {
  typeGroups = {};
  typeIndex = 0;

  currentGraph = {
    nodes: [],
    edges: []
  }
  labelGraph = {
    nodes: [],
    edges: []
  }

  idCache = {};
}

/* ******************************************************
 * Generic AJAX 'GET' request.
 * 
 * Takes a URL and a callback function as input.
 * ******************************************************/
function fetchJsonAjax(url, cfunc) {
  var xhttp;
  if (window.XMLHttpRequest) {
    xhttp = new XMLHttpRequest();
  } else {
    xhttp = new ActiveXObject("Microsoft.XMLHTTP"); // For IE5 and IE6 luddites
  }
  xhttp.onreadystatechange = function() {
    if (xhttp.readyState == 4 && xhttp.status == 200) {
      cfunc(xhttp.responseText);
    }
  }
  xhttp.open("GET", url, true);
  xhttp.send();
}

// Bind our events!
document.getElementById('files').addEventListener('change', handleFileSelect, false);
document.getElementById('paste-parser').addEventListener('click', handleTextarea, false);
document.getElementById('fetch-url').addEventListener('click', handleFetchJson, false);
document.getElementById('header').addEventListener('click', resetPage, false);
uploader.addEventListener('dragover', handleDragOver, false);
uploader.addEventListener('drop', handleFileDrop, false);
