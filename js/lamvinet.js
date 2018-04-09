PC_WIDTH = 1440;
PC_HEIGHT = 405;
EMBED_HEIGHT = 360;
CONTROL_MAIN_HEIGHT = 135;
MID_OFFSET = 720;
WORD_LABEL_HEIGHT = 45;

var pc;
var pc_data;
var model_id2row = {};  // bounded with current UI
var model_row2id = {};  // bounded with current UI
var model_id2row_raw = {};  // bounded with pc_data
var model_row2id_raw = {};  // bounded with pc_data
var model_id2row_cluster = {};
var word_id2col = {};
var word_cluster_col_map = {};
var query = '';
var activeModelId = '';
var heatmap_width = 0;
var heatmap_height = 0;
var hmap_svg;
var hmap_arr;
var hmap_nrow;
var hmap_ncol;
var hmap_cell_rects;
var hmap_tip;
var hmap_tip_fixed = false;
var embed_width = 0;
var embed_fontscale;
var embed_data;
var T;  // tsne object
var Y;  // tsne embedding coordinates
var tsneTimer;
var good_flags = [];
var bad_flags = [];


$(document).ready(function() {
  init();
});


function remove_from_flags(type, w1, w2)
{
  var flags = [];

  if ( type === 'good' )
  {
    flags = good_flags;
  }
  else if ( type === 'bad' )
  {
    flags = bad_flags;
  }
  else
  {
    console.error("Invalid type for flag removal.")
  }

  for ( var i = 0; i != flags.length; i++ )
  {
    if ( (flags[i][0] === w1 && flags[i][1] === w2) || (flags[i][0] === w2 && flags[i][1] === w1) )
    {
      flags.splice(i, 1);
      return;
    }
  }
}


function get_flag_data(type, model_id)
{
  var flags = [];

  if ( type === 'synonyms' )
  {
    flags = good_flags;
  }
  else if ( type === 'antonyms' )
  {
    flags = bad_flags;
  }
  else
  {
    console.error("Invalid flag type.")
    return 0;
  }

  if ( flags.length === 0 )
  {
    return 0;
  }

  var active_model = models[model_id]['vectors']
  var sum = 0;
  flags.forEach(function(wordpair) {
    sum += vectorInnerProduct(active_model[wordpair[0]], active_model[wordpair[1]]);
  });

  return sum / flags.length;
}


function get_data() 
{
  var data = {};

  data['binary_axes'] = [];
  data['model_ids'] = Object.keys(models);
  data['params'] = ['lockf', 'hs', 'negative', 'window', 'alpha', 'sg', 'size'];
  data['perfs'] = ['synonyms', 'antonyms', 'analogy', 'time'];

  var model_data = [];
  Object.keys(models).forEach(function(model_id) {
    var temp_model = models[model_id]['params'];
    temp_model['synonyms'] = get_flag_data('synonyms', model_id);
    temp_model['antonyms'] = get_flag_data('antonyms', model_id);
    
    model_data.push(temp_model);
  });

  data['model_data'] = model_data;

  return data;
}


function init() {
  $("#top-container").height(EMBED_HEIGHT);
  $("#mid-container").height(PC_HEIGHT);
  $("#embed").height(EMBED_HEIGHT);
  $("#embed").width(PC_WIDTH);
  $("#pc").width(PC_WIDTH);
  $("#pc").height(PC_HEIGHT);
  $("#heatmap").height(PC_HEIGHT);
  $("#control-main").height(CONTROL_MAIN_HEIGHT);
  $("#word-label-container").height(WORD_LABEL_HEIGHT);

  var data = get_data();

  pc_data = data.model_data;
  var config = {
    midOffset: {
      axesIdx: data.params.length + 1,
      hiddenAxes: [data.params.length, data.params.length + 1],
      offset: MID_OFFSET
    },
    binaryAxes: data.binary_axes,
  };

  model_id2row = {};
  model_row2id = {};
  model_id2row_raw = {};
  model_row2id_raw = {};

  data.model_ids.forEach(function(d,i) {
    model_id2row[d] = i;
    model_row2id[i] = d;
    model_id2row_raw[d] = i;
    model_row2id_raw[i] = d;
  });
  activeModelId = data.model_ids[0];

  $('#pc').empty();

  pc = d3.parcoords(config)("#pc")
    .data(pc_data)
    .composite("darken")
    .color(function(d) {
        return blue_to_brown(d.accuracy);
      })
    .alpha(0.35)
    .render()
    .brushMode("1D-axes")  // enable brushing
    .reorderable()
    .interactive();  // command line mode

  pc.on('brush', update_heatmap_on_brush);
  pc.on('brushend', update_heatmap_on_brush);
  heatmap_width = pc.midOffsetEnd - pc.midOffsetBegin;
  embed_width = PC_WIDTH;
  heatmap_height = PC_HEIGHT;
  var word_label_svg_width = heatmap_width + 50;
  $("#heatmap").width(heatmap_width);
  $("#heatmap").css("left", pc.midOffsetBegin);

  $("#word-label-div").width(word_label_svg_width);
  $("#word-label-div").css("left", pc.midOffsetBegin);
  d3.select("#word-label-svg")
    .attr("width", word_label_svg_width)
    .attr("height", WORD_LABEL_HEIGHT)
    .attr("viewBox", "0 0 " + word_label_svg_width + " " + WORD_LABEL_HEIGHT);

  $('#query').val('limited');
  submitQuery();

  setup_splom();

  $('#submit-query').click(function() {
    console.log({'event':'submit_query', 'query': $('#query').val(), 'activeModelId': activeModelId});  // only log querying event when user clicks the button.
    submitQuery();
  });
  $('#sort-models-left').click(sort_models_left);
  $('#sort-models-right').click(sort_models_right);
}


// linear color scale
var blue_to_brown = d3.scale.linear()
  .domain([0.5, 0.9])
  .range(["steelblue", "brown"])
  .interpolate(d3.interpolateLab);


function vectorInnerProduct(v1, v2)
{
  if ( v1.length != v2.length )
  {
    console.error("Cannot take inner product between two vectors of different dimension.");
  }

  res = 0;

  for (var i = 0; i != v1.length; i++)
  {
    res += v1[i] * v2[i];
  }

  return res;
}


function findNN(query, k)
{
  var nn_data = {};
  var active_model = models[activeModelId]['vectors'];
  var vocab = Object.keys(active_model);
  var vec = active_model[query];

  var scores_list = {};
  vocab.forEach(function(word) {
    scores_list[word] = vectorInnerProduct(vec, active_model[word]);
  });

  var all_sorted_words = Object.keys(scores_list).sort(function(a,b) { return scores_list[b] - scores_list[a]; });

  nn_data['nn_words'] = all_sorted_words.slice(0, 50);

  nn_data['nn_scores'] = [];
  nn_data['nn_vectors'] = [];
  nn_data['nn_words'].forEach(function(word) {
    nn_data['nn_scores'].push(scores_list[word]);
    nn_data['nn_vectors'].push(active_model[word]);
  });

  return nn_data;
}


function evalNN(query, nn_words)
{
  var scores_list = [];

  Object.keys(models).forEach(function(model_id) {
    var sim_scores = [];
    var current_model = models[model_id]['vectors'];
    var vec = current_model[query];

    nn_words.forEach(function(word) {
      sim_scores.push(vectorInnerProduct(vec, current_model[word]));
    });

    scores_list.push(sim_scores);
  });

  return scores_list;
}


function getQueryData(query)
{
  var data = {};

  data['model_ids'] = Object.keys(models);

  if ( !Object.keys(models[data['model_ids'][0]]['vectors']).includes(query) )
  {
    return {'error': 'Error: Word not in vocabulary.'};
  }

  var nn_data = {};
  nn_data = findNN(query, 50);

  data['nn_words'] = nn_data['nn_words'];
  data['nn_scores'] = nn_data['nn_scores'];
  data['nn_vectors'] = nn_data['nn_vectors'];

  data['scores_list'] = evalNN(query, data['nn_words']);

  data['cluster_sort_idxes'] = Array.from({length: data['scores_list'].length}, (x,i) => i);
  data['col_cluster_sort_idxes'] = Array.from({length: data['scores_list'][0].length}, (x,i) => i);

  return data;
}


function submitQuery() {
  query = $('#query').val();

  result = getQueryData(query);

  if ( Object.keys(result).includes('error') )
  {
    console.warn(result['error']);
    return;
  }

  var words = result.nn_words;
  var vectors = result.nn_vectors;
  var scores = result.nn_scores;
  var model_ids = result.model_ids;
  var scores_list = result.scores_list;
  result.cluster_sort_idxes.forEach(function(d, i) {
    model_id2row_cluster[model_ids[i]] = d;
  });
  result.col_cluster_sort_idxes.forEach(function(d, i) {
    word_cluster_col_map[i] = d;
    word_id2col[i] = i;
  });
  var arr = [];
  var nrow = scores_list.length;
  var ncol = 0;
  for (var i = 0; i < nrow; i++) {
    var row = model_id2row[model_ids[i]];
    ncol = scores_list[i].length;
    for (var j = 0; j < ncol; j++) {
      var cell_obj = {
        row: row,
        col: j,
        model_id: model_ids[i],
        score: scores_list[i][j],
        word_idx: j,
      };
      arr.push(cell_obj);
    }
  }
  $('.d3-tip').remove();
  setup_heatmap_svg(arr, nrow, ncol, words);
  setup_embedding_svg(words, vectors, scores);
}


function setup_heatmap_svg(arr, nrow, ncol, words) {
  hmap_arr = arr;
  hmap_nrow = nrow;
  hmap_ncol = ncol;
  d3.select('#heatmap > *').remove();
  hmap_svg = d3.select('#heatmap')
   .append("svg")
   .attr("width", heatmap_width)
   .attr("height", heatmap_height)
   .attr("viewBox", "0 0 " + heatmap_width + " " + heatmap_height);

  hmap_cell_rects = hmap_svg.selectAll("g.hmap-cell")
    .data(arr)
    .enter()
    .append("rect")
    .classed("hmap-cell", true)
    .style("fill", function(d) {return exciteValueToColor(d.score)})
    .on('mouseover', function(d) {
      if (!hmap_tip_fixed) {
        show_hmap_tip(d);
        embed_data[d.word_idx].highlight = true;
        highlight_embedding_labels();
      }
    })
    .on('mouseout', function(d) {
      if (!hmap_tip_fixed) {
        hide_hmap_tip(d);
        embed_data[d.word_idx].highlight = false;
        highlight_embedding_labels();
      }
    })
    .on('click', function(d) {
      if (hmap_tip_fixed) {
        hide_hmap_tip(d);
        hmap_tip_fixed = false;
        embed_data[d.word_idx].highlight = true;
        highlight_embedding_labels();
      } else {
        $("#tip-control-div").show();
        hmap_tip_fixed = true;
      }
    });

  hmap_svg.append('circle')
    .style('fill', 'yellow')
    .attr('r', 4)
    .classed('active-model-indicator', true);

  hmap_tip = d3.tip()
    .attr('class', 'd3-tip')
    .offset([-10, 0])
    .html(function(d) {
      var q = query.includes(',') ? query.split(',',2)[0] : query;
      return '<div id="d3-tip-div">' +
        "<span style='color:lightblue'>" + words[d.word_idx] + "</span>" +
        " <--> <span style='color:darkorange'>" + q + "</span><br>" +
        "Score = <span style='color:white'>" + d.score.toFixed(3) + "</span><br><br>" +
        "<strong>Model:</strong> " + model_id2row_raw[d.model_id] + "<br>" +
        '<span hidden id="tip-flaggedas-span"></span>' +

        '<div hidden id="tip-control-div">' +
          '<br><br>' +
            '<span>Mark As</span>&nbsp;&nbsp;' +
            '<button class="btn-tip" id="btn-flag-good">Synonyms</button>' +
            '<button class="btn-tip" id="btn-flag-bad">Antonyms</button>' +
            '<button class="btn-tip" id="btn-flag-reset">Reset</button>' +
          '<br><br>' +
            '<button class="btn-tip" id="btn-focus-model">Focus on this Model</button>' + '<br>' +
            '<button class="btn-tip" id="btn-del-model">Delete this Model</button>' + '<br>'
            '<button class="btn-tip" id="btn-query-word">Query this Word</button>' + '<br>' +
            '<button class="btn-tip" id="btn-zoom-column">Zoom this Column</button>' +
        '</div>' +
      '</div>';
    });

  hmap_svg.call(hmap_tip);

  var wordArr = [];
  words.forEach(function(d,i) {wordArr.push({word:d, idx:i})});
  var wordLabelTexts = d3.select('#word-label-svg')
    .selectAll('text')
    .data(wordArr, function(d) {return d.word});
  wordLabelTexts.enter()
    .append('text')
    .classed('heatmap-word-label', true)
    .text(function(d) {return d.word})
    .attr("text-anchor", 'start')
    .attr('alignment-baseline', 'hanging')
    .attr('fill-opacity', 0);
  wordLabelTexts.exit().remove();


  zoom_to_column(0);
  update_heatmap_svg();
}


function zoom_to_column(col) {
  var w = Math.min(15, Math.floor(hmap_ncol / 3));
  var a = Math.floor(col - w / 2);
  var b = Math.floor(col + w / 2);
  if (a < 0) {
    zoom_begin = 0;
    zoom_end = Math.min(hmap_ncol, zoom_begin + w);
  } else if (b > hmap_ncol) {
    zoom_end = hmap_ncol;
    zoom_begin = Math.max(0, zoom_end - w);
  } else {
    zoom_begin = a;
    zoom_end = b;
  }
}


var n_zoomed_cols;
var n_mini_cols;
var zoomed_region_width;
var mini_region_width;
var zoomed_col_width;
var mini_col_width;
var zoomed_region_left;
var zoomed_region_right;
var cell_height;
var zoom_begin;
var zoom_end;
// Update the cell positions
function update_heatmap_svg() {
  n_zoomed_cols = zoom_end - zoom_begin;
  n_mini_cols = hmap_ncol - n_zoomed_cols;

  zoomed_region_width = 0.6 * heatmap_width;
  mini_region_width = heatmap_width - zoomed_region_width;

  zoomed_col_width = zoomed_region_width / n_zoomed_cols;
  mini_col_width = mini_region_width / n_mini_cols;

  zoomed_region_left = zoom_begin * mini_col_width;
  zoomed_region_right = zoom_begin * mini_col_width + zoomed_region_width;

  cell_height = heatmap_height / hmap_nrow;

  hmap_cell_rects
    .attr("x", function(d) {
      return get_hmap_col_left(d.col);
    })
    .attr("y", function(d) {
      return cell_height * d.row;
    })
    .attr("width", function(d) {
      return get_hmap_col_width(d.col);
    })
    .attr("height", cell_height);

  update_active_model_indicator();
  update_hmap_word_label();
  update_hmap_cell_zoomed_class();
  highlight_embedding_labels();
  update_heatmap_on_brush();
}


function update_active_model_indicator() {
  hmap_svg.select('circle.active-model-indicator')
    .transition()
    .attr('cx', 5)
    .attr('cy', cell_height * model_id2row[activeModelId] + 5);
}


function update_hmap_word_label() {
  d3.select('#word-label-svg')
    .selectAll('text')
    .transition()
    .attr('transform', function(d) {
      var col = word_id2col[d.idx];
      var x = get_hmap_col_left(col) + 0.2 * get_hmap_col_width(col);
      return "translate("+ x + ",0) rotate(20,0,0)";
    })
    .attr("fill-opacity", function(d) {
      var col = word_id2col[d.idx];
      if (col < zoom_begin || col >= zoom_end) return 0;
      else return 1;
    });
}


function show_hmap_tip(d) {
  hmap_tip.show(d);
  var w1 = embed_data[d.word_idx].word
  var w2 = get_query();  // don't use global var query.

  var updateFlagSpan = function() {
    var flag = get_flag(w1, w2);
    if (flag.length > 0) {
      if (flag == 'good') {
        flag = '<span style="color:limegreen">'+flag+'</span>';
      } else {
        flag = '<span style="color:red">'+flag+'</span>';
      }
      $('#tip-flaggedas-span').html('Flagged as ' + flag).show();
    } else {
      $('#tip-flaggedas-span').hide();
    }
  }

  var sendFlagQuery = function(flag_type) {
    if ( flag_type === 'good' )
    {
      good_flags.push([w1, w2]);
    }
    else if ( flag_type === 'bad' )
    {
      bad_flags.push([w1, w2]);
    }
    else if ( flag_type === 'reset' )
    {
      remove_from_flags('good', w1, w2);
      remove_from_flags('bad', w1, w2);
    }
    else if ( flag_type === 'check' )
    {
    }
    else
    {
      console.error("Invalid flag query.");
      return;
    }

    updateFlagSpan();
    color_embedding_svg();

    result = get_data();
    var model_data = result.model_data;
    for (var i = 0; i < model_data.length; i++) {
      for (var key in model_data[i]) {
        if (key == 'idx1' || key == 'idx2') continue;
        pc_data[i][key] = model_data[i][key];
      }
    }
    // don't change the order of the following three calls!
    pc.forceRescaleY();
    pc.render();
    pc.updateAxes();

    setup_splom();
  };

  $('#btn-flag-good').click(function(e) {
    embed_data[d.word_idx].highlight_always = false;
    hide_hmap_tip(d);
    sendFlagQuery('good');
    e.stopPropagation();
  });

  $('#btn-flag-bad').click(function(e) {
    embed_data[d.word_idx].highlight_always = false;
    hide_hmap_tip(d);
    sendFlagQuery('bad');
    e.stopPropagation();
  });

  $('#btn-flag-reset').click(function(e) {
    embed_data[d.word_idx].highlight_always = false;
    hide_hmap_tip(d);
    sendFlagQuery('reset');
    e.stopPropagation();
  });

  $('#btn-focus-model').click(function(e) {
    //send_log({'event': 'focus_model', 'activeModelId': d.model_id});
    activeModelId = d.model_id;
    hmap_tip_fixed = false;
    hide_hmap_tip(d);
    submitQuery();
    e.stopPropagation();
  });

  $('#btn-query-word').click(function(e) {
    //send_log({'event': 'submit_query_from_tip', 'query': w1, 'activeModelId': activeModelId});
    hmap_tip_fixed = false;
    hide_hmap_tip(d);
    $('#query').val(w1);
    submitQuery();
    e.stopPropagation();
  });

  $('#btn-zoom-column').click(function(e) {
    //send_log({'event': 'zoom_to_column', 'col': d.col});
    zoom_to_column(d.col);
    update_heatmap_svg();
  });

  $('#d3-tip-div').click(function() {
    hide_hmap_tip(d);
  });

  updateFlagSpan();
}


function hide_hmap_tip(d) {
  hmap_tip_fixed = false;
  hmap_tip.hide(d);
  embed_data.forEach(function(d) {d.highlight = false});
  highlight_embedding_labels();  // update connectors
}


function update_hmap_cell_zoomed_class() {
  // mini_col
  hmap_cell_rects.filter(function(d) {
    if (d.col < zoom_begin || d.col >= zoom_end) return true;
    else return false;
  })
  .classed("mini-col", true)
  .classed("zoomed-col", false);

  // zoomed_col
  hmap_cell_rects.filter(function(d) {
    if (d.col < zoom_begin || d.col >= zoom_end) return false;
    else return true;
  })
  .classed("mini-col", false)
  .classed("zoomed-col", true);
}


function get_hmap_col_left(col) {
  if (col < zoom_begin) return col * mini_col_width;
  else if (col < zoom_end) return zoomed_region_left + (col - zoom_begin) * zoomed_col_width;
  else return zoomed_region_right + (col - zoom_end) * mini_col_width;
}


function get_hmap_col_width(col) {
  if (col < zoom_begin || col >= zoom_end) return mini_col_width;
  else return zoomed_col_width;
}


function update_heatmap_on_brush() {
  var brushedObjs = pc.brushed();
  if (brushedObjs === false) return;
  var brushedRows = {};
  brushedObjs.forEach(function(d) {
    brushedRows[-d.idx1] = 1;
  });
  hmap_cell_rects
    .style("opacity", function(d) {
      if (d.row in brushedRows) return 1.0;
      else return 0.2;
    });
}


function exciteValueToColor(x) {
  return numToColor(x);
}


var colors = ["#427DA8", "#6998BB", "#91B3CD", "#BAD0E0",
              "#E1ECF3", "#FADEE0", "#F2B5BA", "#EA8B92",
              "#E2636C", "#DB3B47"];
numToColor = d3.scale.linear()
  .domain(d3.range(1,-1, -2 / (colors.length -1)))
  .range(colors);  // global


function setup_embedding_svg(words, vectors, scores) {
  embed_fontscale = d3.scale.linear()
    .domain([d3.min(scores)-0.1, 1.2])
    .range([12, 25])
    .clamp(true);

  // compose new embed_data
  // whlie preserving last query's highlighted embedding vectors
  // ugly...i know. But don't change the position of "embed_data=[]"
  var old_embed_data = {};  // key: word
  if (typeof embed_data !== 'undefined' && embed_data) {
    embed_data.forEach(function(d) {
      old_embed_data[d.word] = d;
    });
  }
  embed_data = [];
  for (var i = 0; i < words.length; i++) {
    var word = words[i];
    if (old_embed_data.hasOwnProperty(word)) {
      highlight = old_embed_data[word].highlight;
      highlight_always = old_embed_data[word].highlight_always;
    } else {
      highlight = false;
      highlight_always = false;
    }
    embed_data.push({
      word: words[i],
      score: scores[i],
      word_idx: i,
      highlight: highlight,
      highlight_always: highlight_always,
    });
  }

  var embed_svg = d3.select('#embed-svg')
    .attr("width", embed_width)
    .attr("height", EMBED_HEIGHT);

  var g = embed_svg.selectAll(".embed-unit")
    .data(embed_data, function(d) { return d.word; });

  // enter
  g.enter()
    .append("g")
    .classed("embed-unit", true)
    .append("text")
    .classed("embed-label", true)
    .attr('text-anchor', 'middle')
    .attr('alignment-baseline', 'baseline')
    .attr("font-size", function(d) { return embed_fontscale(d.score) })
    .attr('font-weight', function(d) { return is_word_query(d.word) ? 'bold' : 'normal' })
    .attr('fill-opacity', 0)
    .text(function(d) { return d.word; })
    .on('mouseover', function(d,i) {
      embed_data[d.word_idx].highlight = true;
      highlight_embedding_labels();
    })
    .on('mouseout', function(d) {
      embed_data[d.word_idx].highlight = false;
      highlight_embedding_labels();
    })
    .on('click', function(d) {
      embed_data[d.word_idx].highlight_always = !embed_data[d.word_idx].highlight_always;
      if (embed_data[d.word_idx].highlight_always) {
        console.log({'event': 'click_embedding_label', 'word': d.word});  // only log when this is turned on.
        zoom_to_column(word_id2col[d.word_idx]);
        update_heatmap_svg();
      }
      highlight_embedding_labels();
    });

  // update

  // exit
  g.exit().remove();

  // this propogates parent data's change to child data
  // http://stackoverflow.com/questions/18831949
  embed_svg.selectAll("g.embed-unit")
    .select('text.embed-label');

  var zoomListener = d3.behavior.zoom()
    .scaleExtent([0.1, 20])
    .center([0,0])
    .on("zoom", zoomHandler);
  zoomListener(embed_svg);

  var opt = {epsilon: 10, perplexity: 30};
  T = new tsnejs.tSNE(opt); // create a tSNE instance
  T.words = words;
  T.initDataRaw(vectors);
  step_tsne_phase1();

  color_embedding_svg();
}


var tx=0, ty=0;
var ss=1;
var scaleLens = 200;
var xShrinkFactor = 1.3;
var yShrinkFactor = 0.3;
function zoomHandler() {  // for embedding svg
  tx = d3.event.translate[0];
  ty = d3.event.translate[1];
  ss = d3.event.scale;
  update_embedding_svg();
  highlight_embedding_labels();  // update connectors that are always on
}


function update_embedding_svg(useTransition) {
  Y = T.getSolution();
  var embedUnits = d3.select('#embed-svg').selectAll('.embed-unit');
  if (useTransition)  embedUnits = embedUnits.transition();
  embedUnits.attr("transform", function(d) {
      return "translate(" + get_embed_x(d.word_idx) + "," +
                            get_embed_y(d.word_idx) + ")"; });
  d3.selectAll('.embed-label').attr('fill-opacity', 0.8);
}


function color_embedding_svg() {
  embed_data.forEach(function(d) {
    d.is_query = is_word_query(d.word);  // there can be a two-word query
    var q = get_query();
    d.flag = get_flag(q, d.word);
    // if (d.flag) d.highlight_always = true;  // Uncomment this to auto-highlight flagged words
  });
  d3.selectAll('.embed-label')
    .attr("fill", function(d) {
      if (d.is_query) return 'darkorange';
      else {
        if (d.flag == 'good') return 'forestgreen';
        else if (d.flag == 'bad') return 'red';
        return '#333';
      }
    });
  highlight_embedding_labels();  // update connectors.
}


function is_word_query(w) {
  if (query.includes(',')) {
    var words = query.split(',', 2);
    if (w == words[0]) return true;
    else if (w == words[1].trim()) return true;
    else return false;
  } else {
    if (w == query) return true;
    else return false;
  }
}


function get_query() {
  if (query.includes(',')) {
    return query.split(',',2)[0];
  } else {
    return query;
  }
}


function get_embed_x(i) {
  return (Y[i][0]*ss*scaleLens + tx) * xShrinkFactor + embed_width/2;
}


function get_embed_y(i) {
  return (Y[i][1]*ss*scaleLens + ty) * yShrinkFactor + EMBED_HEIGHT/2;
}


function step_tsne_phase1() {
  for (var i = 0; i < 200; i++) {
    T.step();
  }
  tsneTimer = setInterval(step_tsne_phase2, 0);
  update_embedding_svg(true);
}


function step_tsne_phase2() {
  T.step(); // do a few steps
  update_embedding_svg();
  highlight_embedding_labels();  // update connectors.

  if (T.iter >= 250) {
    stopIter();
  }
}


function stopIter() {
  clearInterval(tsneTimer);
}


// Enlarge label and draw connector to heatmap column, and draw highlight column boxes
function highlight_embedding_labels() {
  if (typeof embed_data == 'undefined')  return;

  d3.selectAll('.embed-label')
    .transition()
    .attr('font-size', function(d) {
      var fontSize = embed_fontscale(d.score);
      if (d.highlight || d.highlight_always) fontSize *= 2;
      return fontSize;
    });

  var data = [];
  for (var i = 0; i < embed_data.length; i++) {
    if (embed_data[i].highlight || embed_data[i].highlight_always) {
      data.push(i);
    }
  }

  // Embed-Heatmap Connectors
  var connectorPath = function(d) {
    var idx = d;
    var col = word_id2col[idx];
    var x0 = get_embed_x(idx);
    var y0 = get_embed_y(idx);
    var x1 = get_hmap_col_left(col) + get_hmap_col_width(col) / 2 + pc.midOffsetBegin;
    var y1 = EMBED_HEIGHT;
    var yMid = (y0 + y1) / 2;
    return 'M ' + x0 + ' ' + y0
        + ' C ' + x0 + ' ' + yMid
        + '   ' + x1 + ' ' + yMid
        + '   ' + x1 + ' ' + y1;
  };

  var embed_svg = d3.select('#embed-svg');
  var connectors = embed_svg.selectAll('.embed-heatmap-connector')
    .data(data, function(d) {return embed_data[d].word});

  // update
  connectors
    .attr("d", connectorPath);

  // enter
  connectors.enter().append("path")
    .classed('embed-heatmap-connector', true)
    .attr('d', connectorPath);

  // remove
  connectors.exit().remove();


  // Heatmap Column Highlight Boxes
  var boxPosition = function(sel) {
    sel
      .attr('x', function(d) {return get_hmap_col_left(word_id2col[d]) + 0.2 })
      .attr('y', 0.2)
      .attr('width', function(d) { return get_hmap_col_width(word_id2col[d]) - 0.2 })
      .attr('height', heatmap_height-0.2)
      .style('fill', 'none');
  };

  var boxes = hmap_svg.selectAll('.hmap-highlight-box')
    .data(data, function(d) {return embed_data[d].word});

  // update
  boxes.transition()
    .call(boxPosition);

  // enter
  boxes.enter()
    .append('rect')
    .classed('hmap-highlight-box', true)
    .call(boxPosition);

  // remove
  boxes.exit().remove();
}


function sort_models_left() {
  console.log({'event': 'sort_models_left'});
  var keys = pc.getOrderedDimensionKeys();
  var sortKey = keys[keys.indexOf('idx1') - 1];
  sort_models_by_key(sortKey);
}


function sort_models_right() {
  console.log({'event': 'sort_models_right'});
  var keys = pc.getOrderedDimensionKeys();
  var sortKey = keys[keys.indexOf('idx2') + 1];
  sort_models_by_key(sortKey);
}


function sort_models_by_key(key) {
  var model_ids = d3
    .keys(model_id2row)
    .sort(function(id1, id2) {
      var data1 = pc_data[model_id2row_raw[id1]];
      var data2 = pc_data[model_id2row_raw[id2]];
      return d3.descending(data1[key], data2[key]);
    });
  var row_map = {};
  model_ids.forEach(function(d,i) {
    row_map[model_id2row[d]] = i;
  });

  sort_heatmap_row(row_map);
}


function sort_heatmap_row(row_map) {
  for (var row in row_map) {
    var id = model_row2id[row];
    model_id2row[id] = row_map[row];
  }
  for (var id in model_id2row) {
    model_row2id[model_id2row[id]] = id;
  }
  hmap_arr.forEach(function(d) {
    d.row = row_map[d.row];
  });
  hmap_cell_rects
    .transition()
    .attr("y", function(d) {
      return cell_height * d.row;
    });

  pc_data.forEach(function(d) {
    var rowOld = -d.idx1;
    var rowNew = row_map[rowOld];
    d.idx1 = -rowNew;
    d.idx2 = -rowNew;
  });
  pc.render();

  update_active_model_indicator();
}


function get_flag(w1,w2) {
  for (var i = 0; i < good_flags.length; i++) {
    if (good_flags[i][0] == w1 && good_flags[i][1] == w2) {
      return 'good';
    } else if (good_flags[i][1] == w1 && good_flags[i][0] == w2) {
      return 'good';
    }
  }
  for (var i = 0; i < bad_flags.length; i++) {
    if (bad_flags[i][0] == w1 && bad_flags[i][1] == w2) {
      return 'bad';
    } else if (bad_flags[i][1] == w1 && bad_flags[i][0] == w2) {
      return 'bad';
    }
  }
  return '';
}


function update_flags() {
  sendFlagQuery('check');
}


function enumerate_params(params) {
  let f = (a, b) => [].concat(...a.map(a => b.map(b => [].concat(a, b))));
  let cartesian = (a, b, ...c) => b ? cartesian(f(a, b), ...c) : a;

  temp = [];
  params.forEach(function(n) {
    temp.push(n['values']);
  });

  let output = cartesian(...temp);

  return output;
}


function get_jitter(scale) {
	return scale * (Math.random() * 2 - 1);
}


function jitter_data() {
	splom_data = pc_data;

	var jitter_scale = 0.001;

	splom_data.forEach(function(n) {
		OUTPUT_PARAMS.forEach(function(p) {
			if(n[p]) {
				n[p] = parseFloat(n[p]) + get_jitter(jitter_scale);
			}
		});
	});
}


function setup_splom() {
	jitter_data();

	$('#splom').empty();
	SPLOM_PARAMS = [];

	OUTPUT_PARAMS.forEach(function(n) {
		SPLOM_PARAMS.push(n);
	})

	param_options.forEach(function(n) {
		if (n.values.length > 2) {
			SPLOM_PARAMS.push(n.name);
		}
	});

	var width = 1000,
    	size = $(window).width() * 0.125,
    	padding = 20,
    	n = SPLOM_PARAMS.length,
    	k = OUTPUT_PARAMS.length;

	var x = d3.scale.linear()
	    .range([padding / 2, size - padding / 2]);

	var y = d3.scale.linear()
	    .range([size - padding / 2, padding / 2]);

	var xAxis = d3.svg.axis()
	    .scale(x)
	    .orient("top")
	    .ticks(6);

	var yAxis = d3.svg.axis()
	    .scale(y)
	    .orient("left")
	    .ticks(6);

	var color = d3.scale.category10();

	var domainByParam = {};
	SPLOM_PARAMS.forEach(function(param) {
		temp = [];
		splom_data.forEach(function(n) {
			temp.push(n[param]);
		});
		domainByParam[param] = d3.extent(temp);
	});

	xAxis.tickSize(-size * n);
	yAxis.tickSize(-size * n);

	var brush = d3.svg.brush()
	  .x(x)
	  .y(y)
	  .on("brushstart", brushstart)
	  .on("brush", brushmove)
	  .on("brushend", brushend);

	var svg = d3.select("#splom").append("svg")
	  .classed("splom", true)
	  .attr("width", size * n + 2 * padding)
	  .attr("height", size * k + 2 * padding)
	  .append("g")
	  .attr("transform", "translate(" + padding + "," + padding + ")");

	svg.selectAll(".x.axis")
	  .data(SPLOM_PARAMS)
	  .enter().append("g")
	  .attr("class", "x axis")
	  .attr("transform", function(d, i) { return "translate(" + (n - i - 1) * size + ",5)"; })
	  .each(function(d) { x.domain(domainByParam[d]); d3.select(this).call(xAxis); });

	svg.selectAll(".y.axis")
	  .data(OUTPUT_PARAMS)
	  .enter().append("g")
	  .attr("class", "y axis")
	  .attr("transform", function(d, i) { return "translate(0," + i * size + ")"; })
	  .each(function(d) { y.domain(domainByParam[d]); d3.select(this).call(yAxis); });

	var cell = svg.selectAll(".cell")
	  .data(truncate_cross(cross(SPLOM_PARAMS, SPLOM_PARAMS)))
	  .enter().append("g")
	  .attr("class", "cell")
	  .attr("transform", function(d) { return "translate(" + (n - d.i - 1) * size + "," + d.j * size + ")"; })
	  .each(plot);

	// Titles for the diagonal.
	cell.filter(function(d) { return d.i === d.j; }).append("text")
	  .attr("x", padding)
	  .attr("y", padding)
	  .attr("dy", ".71em")
	  .text(function(d) { return d.x; });

	// Titles for top-level input parameter cells
	cell.filter(function(d) { return d.j === 0 && OUTPUT_PARAMS.indexOf(d.x) === -1; }).append("text")
		.attr("x", size * 0.45)
		.attr("y", -padding)
		.attr("dy", ".6em")
		.text(function(d) { return d.x; });

	cell.call(brush);

	function plot(p) {
		var cell = d3.select(this);

		x.domain(domainByParam[p.x]);
		y.domain(domainByParam[p.y]);

		cell.append("rect")
		    .attr("class", "frame")
		    .attr("x", padding / 2)
		    .attr("y", padding / 2)
		    .attr("width", size - padding)
		    .attr("height", size - padding);

		cell.selectAll("circle")
		    .data(splom_data)
		  	.enter().append("circle")
		    .attr("cx", function(d) { return x(d[p.x]); })
		    .attr("cy", function(d) { return y(d[p.y]); })
		    .attr("r", 4)
		    .style("fill", function(d) { return "lightblue"; });
	}

	var brushCell;

	// Clear the previously-active brush, if any.
	function brushstart(p) {
	if (brushCell !== this) {
	  d3.select(brushCell).call(brush.clear());
	  x.domain(domainByParam[p.x]);
	  y.domain(domainByParam[p.y]);
	  brushCell = this;
	}
	}

	// Highlight the selected circles.
	function brushmove(p) {
	var e = brush.extent();
	svg.selectAll("circle").classed("noshow", function(d) {
	  return e[0][0] > d[p.x] || d[p.x] > e[1][0]
	      || e[0][1] > d[p.y] || d[p.y] > e[1][1];
	});
	}

	// If the brush is empty, select all circles.
	function brushend() {
	if (brush.empty()) svg.selectAll(".noshow").classed("noshow", false);
	}

	function cross(a, b) {
	  var c = [], n = a.length, m = b.length, i, j;
	  for (i = -1; ++i < n;) for (j = -1; ++j < m;) c.push({x: a[i], i: i, y: b[j], j: j});
	  return c;
	}

	function truncate_cross(c) {
		var truncate_point = OUTPUT_PARAMS.length - 1;

		var i = 0;
		while (i < c.length) {
			if (c[i].j > truncate_point) {
				c.splice(i, 1);
			} else {
				i++;
			}
		}

		return c;
	}
}
