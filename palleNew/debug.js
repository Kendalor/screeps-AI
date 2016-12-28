var MAX_CALL_SIZE = 12;

module.exports = {
  dump: function(bool,object){
    if (bool) 
      console.log(JSON.stringify(object));
  }  
}
