var Operation = {};
Object.defineProperties(Operation,{
	
	'memory' : {
		get: function() {
			if (Memory.operations === undefined) {
				Memory.operations = {};
			}
			if (Memory.operations[this.id] === undefined) {
				Memory.operations[this.id] = {};
			}
			return Memory.operations[this.id];
		},
		set: function(v) {
			return _.set(Memory, 'operations.' + this.id, v);
		},
		configurable: true,
		enumerable: false
	},
	
	'roomName' : {
		get: function() {
			if (this.memory.roomName === undefined) {
				this.memory.roomName = {};
			}
			return this.memory.roomName;
		},
		set: function(v) {
			return _.set(this.memory '.roomName,', v);
		},
		configurable: true,
		enumerable: true
	},
	
	'flagName' : {
		get: function() {
			if (this.memory.flagName === undefined) {
				this.memory.flagName = {};
			}
			return this.memory.flagName;
		},
		set: function(v) {
			return _.set(this.memory '.flagName,', v);
		},
		configurable: true,
		enumerable: true
	},
	
	'isPermanent' : {
		get: function() {
			if (this.memory.isPermanent === undefined) {
				this.memory.isPermanent = {};
			}
			return this.memory.isPermanent;
		},
		set: function(v) {
			return _.set(this.memory '.isPermanent,', v);
		},
		configurable: true,
		enumerable: true
	},
	
	'type' : {
		get: function() {
			if (this.memory.type === undefined) {
				this.memory.type = {};
			}
			return this.memory.isPermanent;
		},
		set: function(v) {
			return _.set(this.memory '.type,', v);
		},
		configurable: true,
		enumerable: true
	}
	
});
module.exports = Operation;