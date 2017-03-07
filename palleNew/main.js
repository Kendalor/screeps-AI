require('prototypes')();
//require('globals')();
//const profiler          = require('screeps-profiler');
const autoCreep         = require('auto.creep');
const autoMemory        = require('auto.memory');
const autoSpawn         = require('auto.spawn');
const invasionCounter   = require('invasion.counter');

//Kendalor Code
const operationsHandler = require('operations.handler');

//const pause = true;
const pause = false;

//profiler.enable();
module.exports.loop = function () {
    if (Game.cpu.bucket < 10000){ // To check if accumulated bonus CPU is used sometimes
    		console.log("Used additional CPU.\nAccumulated bucket:  "+Game.cpu.bucket+"/10000");
	}
    
    if(!pause){
    
    	if(!Memory.myRooms){
    	    Memory.myRooms={};
    	    for (var name in Game.rooms){
    	        if(Game.rooms[name].controller.my){
    	            Memory.myRooms[name]={};
    				Game.rooms[name].findMinerals();
    				Game.rooms[name].findSources();
                }
    	    }
    	}
    	
    	var name;
    	for(name in Memory.myRooms) {
    		var room = Game.rooms[name];
    		if (room){
    
    			//autoMemory.fixSourceSlots(room);
    			invasionCounter.run(room);
    
    			autoSpawn.run(room.spawns);
    
    			autoCreep.run(room.myCreeps);
    			
    			//Market
    			if((Game.time+125) % 250 == 0 && room.terminal && room.terminal.store.energy > 200000){
    			    var amount = 40000;
        			var orders = Game.market.getAllOrders(order => order.resourceType == RESOURCE_ENERGY && 
    	                order.type == ORDER_BUY && 
                        Game.market.calcTransactionCost(amount, name, order.roomName) < amount*2);
                    if(orders.length){
                        var bestOrder = orders[0];
                        orders.forEach(function(order){
                            if(order.price > bestOrder.price){
                                bestOrder = order;
                            }
                        });
                        var amount = Math.min(100000,Math.min(bestOrder.amount,bestOrder.remainingAmount));
                        Game.market.deal(bestOrder.id,amount,name);
                    }
    			}
    			//Market End
    		
    		}else{
    		    delete room.memory;
    			delete Memory.myRooms[name];
    		}
    	}
    	
    	//Kendalor Code
        if (Game.cpu.bucket > 5000){
    	    operationsHandler.init();
    	    operationsHandler.run();
        }
    
    	if(Game.time % 500 == 0){
    		autoMemory.clearDeadCreeps();
    		//autoMemory.clearFlags();
    	}
    }
}/**/