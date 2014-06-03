Upload = require('../lib/');
assert = require('assert');
path = require('path');
S3 = require('aws-sdk').S3;
fs = require('fs');
gm = require('gm').subClass({imageMagick: true});
path = require('path');

client = null;

beforeEach(function() {
  client = new Upload('turadmin', {
    url: 'https://s3-eu-west-1.amazonaws.com/turadmin/',
    path: 'images_test/'
  });
});

describe('new Client()', function() {
  it('should instasiate correctly', function() {
    assert(client.s3 instanceof S3);
  });

  describe('#_resizeOriginal()', function() {
    this.timeout(20000);

    it('should return exif data', function(done) {
      client._resizeOriginal(path.resolve('./test/assets/photo.jpg'), function(err, buffer, exif) {
        assert.ifError(err);

        gm(buffer).write('./test_output/photo.jpg', function(err) {
          assert.ifError(err);
          done();
        });
      });
    });

    it('should autorotate image', function(done) {
      client._resizeOriginal(path.resolve('./test/assets/rotate.jpg'), function(err, buffer, exif) {
        assert.ifError(err);

        gm(buffer).write('./test_output/rotate.jpg', function(err) {
          assert.ifError(err);
          done();
        });
      });
    });

    it('should do this', function(done) {
      client._resizeOriginal(path.resolve('test/assets/cmyk.jpg'), function(err, buffer, exif) {
        assert.ifError(err);

        gm(buffer).write('./test_output/cmyk.jpg', function(err) {
          assert.ifError(err);
          done()
        });
      });
    });
  });

  describe('#_getRandomPath()', function() {
    it('should return a new random path', function() {
      var path = client._getRandomPath();
      assert(/^images_test\/[A-Za-z0-9]{2}\/[A-Za-z0-9]{2}\/[A-Za-z0-9]{2}$/.test(path));
    });
  });

  describe('#_uploadPathIsAvailable()', function() {
    it('should return true for avaiable path', function(done) {
      this.timeout(10000);

      if (process.env.INTEGRATION_TEST !== 'true') {
        client.s3.listObjects = function(opts, cb) { return cb(null, {Contents: []}); }
      }

      client._uploadPathIsAvailable('this/should/not/exist', function(err, isAvaiable) {
        assert.ifError(err);
        assert.equal(isAvaiable, true);
        done();
      });
    });

    it('should return false for unavaiable path', function(done) {
      this.timeout(10000);

      if (process.env.INTEGRATION_TEST !== 'true') {
        client.s3.listObjects = function(opts, cb) { return cb(null, {Contents: [opts.Prefix]}); }
      }

      client._uploadPathIsAvailable('images_test/', function(err, isAvaiable) {
        assert.ifError(err);
        assert.equal(isAvaiable, false);
        done();
      });
    });
  });

  describe('#_uploadGeneratePath()', function() {
    it('should return an avaiable path', function(done) {
      client._uploadPathIsAvailable = function(path, cb) { return cb(null, true); };
      client._uploadGeneratePath(function(err, path) {
        assert.ifError(err);
        assert(/^images_test\/[A-Za-z0-9]{2}\/[A-Za-z0-9]{2}\/[A-Za-z0-9]{2}$/.test(path));
        done();
      });
    });

    it('should retry if selected path is not avaiable', function(done) {
      var i = 0;
      client._uploadPathIsAvailable = function(path, cb) { return cb(null, (++i === 5)); };
      client._uploadGeneratePath(function(err, path) {
        assert.ifError(err);
        assert.equal(i, 5);
        assert(/^images_test\/[A-Za-z0-9]{2}\/[A-Za-z0-9]{2}\/[A-Za-z0-9]{2}$/.test(path));
        done();
      });
    });
  });

  describe('#_uploadBuffer()', function() {
    var buffer = null
      , key = 'images_test/ab/cd/ef.jpg'
      , type = 'image/jpeg';

    beforeEach(function() {
      buffer = fs.readFileSync('./test/assets/hans.jpg');
    });

    it('should set function parameters in put options', function(done) {
      client.s3.putObject = function(opts, cb) {
        assert.deepEqual(opts, {
          ContentType: type,
          Body: buffer,
          Key: key
        });
        cb()
      };
      client._uploadBuffer(buffer, key, type, {}, done);
    });

    it('should set optional put options', function(done) {
      client.s3.putObject = function(opts, cb) {
        assert.deepEqual(opts.Metadata, {foo: 'bar'});
        cb()
      };
      client._uploadBuffer(buffer, key, type, {Metadata: {foo: 'bar'}}, done);
    });

    it('should set global S3 options', function(done) {
      client.s3Defaults = {ACL: 'public'};
      client.s3.putObject = function(opts, cb) {
        assert.equal(opts.ACL, 'public');
        cb()
      };
      client._uploadBuffer(buffer, key, type, {}, done);
    });

    it('should set global S3 options without overriding local options', function(done) {
      client.s3Defaults = {ACL: 'public', Foo: 'bar'};
      client.s3.putObject = function(opts, cb) {
        assert.equal(opts.ACL, 'private');
        assert.equal(opts.Foo, 'bar');
        cb()
      };
      client._uploadBuffer(buffer, key, type, {ACL: 'private'}, done);
    });

    it('should successfully put buffer to S3', function(done) {
      this.timeout(10000);
      if (process.env.INTEGRATION_TEST !== 'true') {
        client.s3.putObject = function(opts, cb) { return cb(null, {ETag: '9c4eec0786092f06c9bb75886bdd255b'}); };
        client._uploadBuffer(buffer, key, type, {}, function(err, data) {
          assert.deepEqual(data, {ETag: '9c4eec0786092f06c9bb75886bdd255b'});
          done()
        });
      } else {
        client._uploadBuffer(buffer, key, type, {}, function(err, data) {
          assert.ifError(err);
          assert.equal(typeof data.ETag, 'string');
          client.s3.deleteObject({Key: key}, done); // Clean up after upload
        });
      }
    });
  });

  describe('#_upload()', function() {
    beforeEach(function() {
      client._getRandomPath = function() { return 'images_test/ab/cd/ef' };
      client._uploadPathIsAvailable = function(path, cb) { return cb(null, true); };
    });

    if (process.env.INTEGRATION_TEST === 'true') {
      afterEach(function(done) {
        client.s3.deleteObjects({Delete: { Objects: [{
          Key: 'images_test/ab/cd/ef.jpg'
        },{
          Key: 'images_test/ab/cd/ef-375.jpg'
        },{
          Key: 'images_test/ab/cd/ef-150.jpg'
        }]}}, function(err) {
          assert.ifError(err);
          done()
        });
      });
    }

    var files = [{
      tmpName: path.resolve('./test/assets/hans.jpg'),
      contentType: 'image/jpeg',
      ext: 'jpg',
      org: true,
      height: 1366,
      width: 1024
    },{
      tmpName: path.resolve('./test/assets/hans-500.jpg'),
      contentType: 'image/jpeg',
      ext: 'jpg',
      height: 500,
      width: 375
    },{
      tmpName: path.resolve('./test/assets/hans-200.jpg'),
      contentType: 'image/jpeg',
      ext: 'jpg',
      height: 200,
      width: 150
    }];

    it('should upload all files successfully', function(done) {
      this.timeout(10000);

      if (process.env.INTEGRATION_TEST !== 'true') {
        var etags = {
          'images_test/ab/cd/ef.jpg': '"9c4eec0786092f06c9bb75886bdd255b"',
          'images_test/ab/cd/ef-375.jpg': '"a8b7ced47f0a0287de13e21c0ce03f4f"',
          'images_test/ab/cd/ef-150.jpg': '"20605bd03842d527d9cf16660810ffa0"'
        }
        client.s3.putObject = function(opts, cb) { return cb(null, {ETag: etags[opts.Key]}); }
      }

      client._upload(files, function(err, results) {
        assert.ifError(err);

        assert(results instanceof Array);
        assert.equal(results.length, 3);

        assert.equal(typeof results[0].tmpName, 'string');
        assert.equal(results[0].contentType, 'image/jpeg');
        assert.equal(results[0].ext, 'jpg');
        assert.equal(typeof results[0].height, 'number');
        assert.equal(typeof results[0].width, 'number');
        assert.equal(typeof results[0].key, 'string');
        assert.equal(typeof results[0].url, 'string');
        assert.equal(typeof results[0].etag, 'string');

        done()
      });
    });
  });
});

describe('Image', function () {

	it('should return size', function (done) {
		var portraitJpg = path.resolve('test/assets/portrait.jpg');
		client._getSize(portraitJpg, function(err, value) {
      assert.ifError(err);
      assert.equal(value.width, 3421);
      assert.equal(value.height, 5434);
			done();
		});
	});

	// var sizes = client.sizes;
	var sizes = [false, 780, 320];

	for (var i = 0; i < sizes.length; i++) {
		var maxSize = sizes[i];

		it('should resize to the right size', function (done) {

			var portraitJpg = path.resolve('test/assets/portrait.jpg');
			client._resize(portraitJpg, maxSize, function(err, buff) {
				gm(buff).size(function (err, value) {
					assert.equal(Math.max(value.width, value.height), maxSize);
					// done();
				});
			});

			var landscapeJpg = path.resolve('test/assets/landscape.jpg');
			client._resize(landscapeJpg, maxSize, function(err, buff) {
				gm(buff).size(function (err, value) {
					assert.equal(Math.max(value.width, value.height), maxSize);
					// done();
				});
			});

			var landscapePng = path.resolve('test/assets/pngformat.png');
			client._resize(landscapePng, maxSize, function(err, buff) {
				gm(buff).size(function (err, value) {
					assert.equal(Math.max(value.width, value.height), maxSize);
					done();
				});
			});

		});

	}

});