module.exports = {
  creepRole: function(){
  return [
    {id: 0,name: 'miner'},
    {id: 1,name: 'hauler'},
    {id: 2,name: 'maintance'},
    {id: 3,name: 'upgrader'},
    {id: 4,name: 'defender'}
  ];
  },
  /*
  creepRoleMemory:function(){
    return [
      'miner':{role: creepRole[0].name, source: id, spawn: true,job: 'idle', target:null}
    ];
  }
*/
  creepRoleName: function(id){
  return this.creepRole()[id];
  },
  creepRoleId: function(name){
  return this.creepRole().indexOf(name);
  },
  
  creepJob: function(){
  return [
    {id: 0,name: 'mine'},
    {id: 1,name: 'haul'},
    {id: 2,name: 'maintance'},
    {id: 3,name: 'upgrader'}
  ];
  }
}
