/**
  fs.js (c) OptimalBits 2012.
  
  A lightweight wrapper for the File System API inspired in nodejs fs module.
  
  author: manuel@optimalbits.com
*/
define(function() {
  
  window.StorageInfo = window.StorageInfo || window.webkitStorageInfo;
  window.RequestFileSystem = window.RequestFileSystem || window.webkitRequestFileSystem;

  createFileSystem = function (size, folder, cb) {
    folder = folder || 'fs_folder';
    window.StorageInfo.requestQuota(PERSISTENT, size, function (grantedBytes) {
      window.RequestFileSystem(PERSISTENT, grantedBytes, function (fs) {
        fs.root.getDirectory(folder, {create:true}, function (entry) {
          cb(null, new FS(fs, entry, grantedBytes));
        }, cb);
      }, cb);
    }, cb);
  };

  /**
    The wrapper object.
  */
  var FS = function (fs, root, grantedBytes) {
    this.fs = fs;
    this.root = root;
    this._availableBytes = this._grantedBytes = grantedBytes;
  }
  
  FS.prototype = {
    /**
      rename(oldPath, newPath, callback)
    
      Renames a file or directory.
    */
    rename : function(path, newPath, cb){
      var self = this, root = self.root;
      traverse(root, path, function(err, entry){
        if(entry){
          traverse(root, dirname(newPath), function(err, dstDir){
            if(dstDir){
              entry.moveTo(dstDir, basename(newPath), function(){
                cb();
              }, cb);
            }else{
              cb(err);
            }
          });
        }else{
          cb(err);
        }
      });
    },
    
    truncate : function(path, length, cb){
      // IMPLEMENT using FileWriter truncate.
    },
    
    /**
      stat(path, callback)
      
      Calls the callback with stats object with the following data:
      
      isFile, isDirectory, size, mtime (modification time).
    */
    stats : function(path, cb){
      traverse(this.root, path, function(err, entry){
        if(entry){
          entry.getMetadata(function(meta){
            meta.isFile = function(){return entry.isFile};
            meta.isDirectory = function(){return entry.isDirectory};
            cb(null, meta);
          }, cb)
        }else{
          cb(err);
        }
      });
    },
    
    /** 
      Checks if a file exists or not.
      
      Test whether or not the given path exists by checking with the file system. 
      Then call the callback argument with either true or false
    */
    exists : function(path, cb){
      traverse(this.root, path, function(err){
        cb(err ? false : true);
      });
    },
    
    /**
      unlink(filename, callback)
      remove(filename, callback)
      
      Removes the given file from the filesystem.
    */
    unlink : function (filename, cb) {
      var self = this;
      self.root.getFile(filename, {}, function (fileEntry) {
        fileEntry.remove(function () {
          self._availableBytes += fileEntry.size;
          cb(null, true)
        }, cb)
      }, cb)
    },
    
    /**
      Removes a directory and all its contents.
      (to use if removeRecursively not available, or when wanting to delete
      the root of all filesystems).
    */
    rmdir : function(dirname, cb){
      var root = this.root;
      if(dirname == '/'){
        this.readdir('/', function(err, entries){
          if(!err){
            parallel(entries, function(entry, cb){
              entry.removeRecursively(cb, cb);
            }, cb);
          }else{
            cb(err);
          }
        });
      }else{
        traverse(root, dirname, function(err, entry){
          if(err || !entry.isDirectory){
            cb(err || new Error('Path is not a directory'));  
          }else{
            entry.removeRecursively(cb,cb);
          }
        });
      }
    },
    
    /**
      Reads the content of a directory at the given path.
      cb(err, entries {Array of DirectoryEntry:s})
    */
    readdir : function(path, cb){
      traverse(this.root, path, function(err, entry){
        if(err || !entry.isDirectory){
          cb(err || new Error('Path is not a directory'));
        }else{
          var reader = entry.createReader();
          reader.readEntries(function(entries){
            console.log(entries);
            cb(null, entries);
          }, cb);
        }
      });    
    },
    
    mkdir : function(dirpath, cb){
      // TO IMPLEMENT;
    },
    
    readFile : function(filename, cb){
      this.read(filename, cb);
    },
    
    writeFile : function(filename, blob, cb){
      this.write(filename, blob, cb);
    },
    
    appendFile : function(filename, data, cb){
      this.append(filename, data, cb);
    }
  }
  
  FS.prototype.remove = FS.prototype.unlink;

  //File.prototype.getAvailableBytes = function(cb) {
  //  cb(null, this._available_bytes);
  //}

  //TODO: This currently reads a file just as text
  FS.prototype.read = function (filename, cb) {
    traverse(this.root, filename, function (err, entry) {
      if(entry){
        entry.file(function (file) {
          var reader = new FileReader();
          reader.onloadend = function (e) {
            cb(null, this.result);
          };
          reader.readAsText(file);
        }, cb);
      }else{
        cb(err);
      }
    });
  };

  FS.prototype.getBlob = function (filename, cb) {
    traverse(this.root, filename, function (err, entry) {
      if(entry){
        entry.file(function (blob) {
          cb(null, blob);
        }, cb);
      }else{
        cb(err);
      }
    });
  };
  
  FS.prototype.getUrl = function (filename, cb) {
    traverse(this.root, filename, function (err, entry) {
      if(entry){
        cb(null, entry.toURL());
      }else{
        cb(err);
      }
    });
  };
  
  /**
     Writes a blob to a file, and returns fileEntry if succesful.
  */
  FS.prototype.write = function (filename, blob, cb) {
    var self = this;
    self.root.getFile(filename, {create: true, exclusive: true}, function (entry) {
      self.append(filename, blob, cb);
    }, function(err){
      self.remove(filename, function(){
        self.write(filename, blob, cb);
      }, cb);
    });
  };

  FS.prototype.append = function (filename, blob, cb) {
    var self = this;
    this.root.getFile(filename, {create:true}, function (fileEntry) {
      fileEntry.createWriter(function (fileWriter) {
        fileWriter.onwriteend = function (e) {
          self._availableBytes -= fileEntry.size;
          cb(null, fileEntry);
        };
        fileWriter.seek(fileWriter.length);
        fileWriter.onerror = cb;
        fileWriter.write(blob);
      }, cb);
    }, cb);
  };

  FS.prototype.validateFileSize = function(filename, size, cb) {
    traverse(this.root, filename, function (fileEntry) {
      fileEntry.createWriter(function(fileWriter) {
        if (fileWriter.length == size) {
          cb(null, true);
        } else {
          cb(new Error('Wrong filesize'));
        }
      }, cb);
    }, cb);
  };
  
  /**
    Wipes the whole file system. 
    
    wipe(cb, [full])
    
    Use full = true if you want to wipe the root dir of the filesystem,
    after doing this, the instance cannot be used anymore.
  */
  FS.prototype.wipe = function (cb, full) {
    var self = this, folder = self.root.fullPath;
    self.root.removeRecursively(function(){
      if(!full){
        self.fs.root.getDirectory(folder, {create:true}, function (root) {
          self.root = root;
          self._availableBytes = self._grantedBytes;
          cb();
        }, cb);
      }else{
        cb();
      }
    }, cb);
  };
  
  FS.prototype.errorHandler = function (e) {
    var msg = '';

    switch (e.code) {
      case FileError.QUOTA_EXCEEDED_ERR:
        msg = 'QUOTA_EXCEEDED_ERR';
        break;
      case FileError.NOT_FOUND_ERR:
        msg = 'NOT_FOUND_ERR';
        break;
      case FileError.SECURITY_ERR:
        msg = 'SECURITY_ERR';
        break;
      case FileError.INVALID_MODIFICATION_ERR:
        msg = 'INVALID_MODIFICATION_ERR';
        break;
      case FileError.INVALID_STATE_ERR:
        msg = 'INVALID_STATE_ERR';
        break;
      default:
        msg = 'Unknown Error';
        break;
    }

    console.log('File System Error: ' + msg);
  };
  
  /**
     Traverse the file system and returns a FileEntry 
     or a DirectoryEntry (or error if path does not exist).
  */
  function traverse(root, path, cb){    
    function visit(entry, components, index, cb){
      if(index === components.length){
        cb(null, entry);
      }else{
        if(entry.isDirectory){
          entry.getDirectory(components[index], {}, function(entry){
            visit(entry, components, index+1, cb);
          }, function(err){
            if(err && err.code == err.TYPE_MISMATCH_ERR){
              entry.getFile(components[index], {}, function(entry){
                visit(entry, components, index+1, cb);
              }, cb);
            }else{
              cb(err);
            }
          });
        }else{
          cb(new Error(entry.fullPath+' not a valid directory'));
        }
      }
    }
    
    if(path == '/'){
      cb(null, root);
    }else{
      visit(root, path.split('/'), 0, cb);
    }
  }
  
  function dirname(path){
    var s = path.split('/'); 
    s.pop();
    return s.join('/');
  }
  
  function basename(path){
    return path.split('/').pop();
  }
  
  function parallel(entries, fn, cb){
    var counter = 0, length = entries.length, error;
    for(var i=0; i < length; i++){
      fn(entries[i], function(err){
        error = error || err;
        counter++;
        if(counter==length){
          cb(error);
        }
      });
    }
  }
  
  return createFileSystem;
});