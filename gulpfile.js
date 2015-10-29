/*jshint node: true, strict: false */

var fs = require('fs');
var gulp = require('gulp');
var rename = require('gulp-rename');
var replace = require('gulp-replace');

// ----- hint ----- //

var jshint = require('gulp-jshint');

gulp.task( 'hint-js', function() {
  return gulp.src('imagesloaded.js')
    .pipe( jshint() )
    .pipe( jshint.reporter('default') );
});

gulp.task( 'hint-test', function() {
  return gulp.src('test/unit/*.js')
    .pipe( jshint() )
    .pipe( jshint.reporter('default') );
});

gulp.task( 'hint-task', function() {
  return gulp.src('gulpfile.js')
    .pipe( jshint() )
    .pipe( jshint.reporter('default') );
});

var jsonlint = require('gulp-json-lint');

gulp.task( 'jsonlint', function() {
  return gulp.src( '*.json' )
    .pipe( jsonlint() )
    .pipe( jsonlint.report('verbose') );
}); 

gulp.task( 'hint', [ 'hint-js', 'hint-test', 'hint-task', 'jsonlint' ]);

// -------------------------- RequireJS makes pkgd -------------------------- //

// refactored from gulp-requirejs-optimize
// https://www.npmjs.com/package/gulp-requirejs-optimize/

var gutil = require('gulp-util');
var through = require('through2');
var requirejs = require('requirejs');
var chalk = require('chalk');

function rjsOptimize( options ) {
  options = options || {};

  requirejs.define('node/print', [], function() {
    return function(msg) {
      if( msg.substring(0, 5) === 'Error' ) {
        gutil.log( chalk.red( msg ) );
      } else {
        gutil.log( msg );
      }
    };
  });

  var stream = through.obj(function (file, enc, cb) {
    if ( file.isNull() ) {
      return cb( null, file );
    }

    options.logLevel = 2;

    options.out = function( text ) {
      var outFile = new gutil.File({
        path: file.relative,
        contents: new Buffer( text )
      });
      cb( null, outFile );
    };

    gutil.log('RequireJS optimizing');
    requirejs.optimize( options, null, function( err ) {
      var gulpError = new gutil.PluginError( 'requirejsOptimize', err.message );
      stream.emit( 'error', gulpError );
    });
  });

  return stream;
}

// regex for banner comment
var reBannerComment = new RegExp('^\\s*(?:\\/\\*[\\s\\S]*?\\*\\/)\\s*');

function getBanner() {
  var src = fs.readFileSync( 'imagesloaded.js', 'utf8' );
  var matches = src.match( reBannerComment );
  var banner = matches[0].replace( 'imagesLoaded', 'imagesLoaded PACKAGED' );
  return banner;
}

function addBanner( str ) {
  return replace( /^/, str );
}

gulp.task( 'requirejs', function() {
  var banner = getBanner();
  // HACK src is not needed
  // should refactor rjsOptimize to produce src
  return gulp.src('imagesloaded.js')
    .pipe( rjsOptimize({
      baseUrl: 'bower_components',
      optimize: 'none',
      include: [
        '../imagesloaded'
      ]
    }) )
    // remove named module
    .pipe( replace( "'../imagesloaded',", '' ) )
    // add banner
    .pipe( addBanner( banner ) )
    .pipe( rename('imagesloaded.pkgd.js') )
    .pipe( gulp.dest('.') );
});


// ----- uglify ----- //

var uglify = require('gulp-uglify');

gulp.task( 'uglify', [ 'requirejs' ], function() {
  var banner = getBanner();
  gulp.src('imagesloaded.pkgd.js')
    .pipe( uglify() )
    // add banner
    .pipe( addBanner( banner ) )
    .pipe( rename('imagesloaded.pkgd.min.js') )
    .pipe( gulp.dest('.') );
});

// ----- version ----- //

// set version in source files

var minimist = require('minimist');

// use gulp version -t 1.2.3
gulp.task( 'version', function() {
  var args = minimist( process.argv.slice(3) );
  var version = args.t;
  if ( !version || !/\d\.\d\.\d/.test( version ) ) {
    gutil.log( 'invalid version: ' + chalk.red( version ) );
    return;
  }
  gutil.log( 'ticking version to ' + chalk.green( version ) );

  gulp.src('imagesloaded.js')
    .pipe( replace( /imagesLoaded v\d\.\d\.\d/, 'imagesLoaded v' + version ) )
    .pipe( gulp.dest('.') );

  gulp.src( [ 'bower.json', 'package.json' ] )
    .pipe( replace( /"version": "\d\.\d\.\d"/, '"version": "' + version + '"' ) )
    .pipe( gulp.dest('.') );
  // replace CDN links in README
  gulp.src('README.md')
    .pipe( replace( /ajax\/libs\/jquery.imagesloaded\/\d\.\d\.\d/g, 'ajax/libs/jquery.imagesloaded/' + version ))
    .pipe( gulp.dest('.') );
});

// -------------------------- page -------------------------- //

var marked = require('marked');
var highlight = require('highlight.js');

highlight.configure({
  classPrefix: ''
});

var hljsJavascript = highlight.getLanguage('javascript');
// highlight Masonry
hljsJavascript.keywords.imagesloaded_keyword = 'imagesLoaded';
// highlight imgLoad variables
hljsJavascript.keywords.imgload_var = 'imgLoad';

marked.setOptions({
  highlight: function( code, lang ) {
    return lang ? highlight.highlight( lang, code ).value : code;
  }
});

// hash of partials
var partials = {};

var path = require('path');

// crawl files and get their sources
gulp.task( 'partials', function() {
  return gulp.src( [ 'README.md', 'assets/demo.html', 'assets/sponsored.html' ] )
    .pipe( through.obj( function( file, enc, callback ) {
      var basename = path.basename( file.path );
      partials[ basename ] = file.contents.toString();
      return callback( null, file );
    }));
});

gulp.task( 'page', [ 'partials' ], function() {
  var readmeHTML = marked( partials['README.md'] );
  return gulp.src('assets/page.html')
    .pipe( replace( '{{{ content }}}', readmeHTML ) )
    .pipe( replace( '<!-- demo -->', partials['demo.html'] ) )
    .pipe( replace( '<!-- sponsored -->', partials['sponsored.html'] ) )
    .pipe( pageNav() )
    .pipe( rename('index.html') )
    .pipe( gulp.dest('.') );
});

var cheerio = require('cheerio');

function pageNav() {
  return through.obj( function( file, enc, callback ) {
    var $ = cheerio.load( file.contents.toString(), {
      decodeEntities: false
    });
    var pageNavHtml = '\n';
    // query each h2, h3, h4
    $('#content h2').each( function( i, header ) {
      var $header = $( header );
      var title = $header.text();
      // remove HTML entities
      var slug = title.replace( /&[\w\d]+;/gi, '' )
        // replace non alphanumeric to hyphens
        .replace( /[^\w\d]+/gi, '-' )
        // trim trailing hyphens
        .replace( /^\-+/, '' ).replace( /\-+$/, '' ).toLowerCase();
      // set id slug
      $header.attr( 'id', slug );
      // add item to pageNav
      pageNavHtml += '<li class="page-nav__item page-nav__item--' + header.name + '">' +
        '<a href="#' + slug + '">' + title + '</a></li>\n';
    });
    // add pageNavHtml to page
    $('.page-nav').html( pageNavHtml );

    var html = $.html();
    file.contents = new Buffer( html );
    callback( null, file );
  });
}


// ----- default ----- //

gulp.task( 'default', [
  'hint',
  'uglify',
  'page'
]);

