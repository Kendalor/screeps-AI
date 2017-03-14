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
    			
    			if((Game.time+125) % 45 == 0 && room.terminal){
    			    if(room.controller.level < 8){
    			        if(!Memory.rre){//roomRequiresEnergy
    			            Memory.rre = {};
    			        }
    			        if(room.terminal.store.energy < 200000){
    			            if(!Memory.rre[name]){//roomRequiresEnergy
    			                Memory.rre[name] = 250000-room.terminal.store.energy;
    			            }
    			        }else{
    			            if(!Memory.rre[name]){//roomRequiresEnergy
    			                Memory.rre[name] = undefined;
    			            }
    			        }
        			//Market
        			}else{
        			    if(room.terminal.store.energy > 100000 && Memory.rre){
        			        var keys = Object.keys(Memory.rre);
        			        var notHelped = true;
        			        var i;
        			        for(i = 0;i < keys.length && notHelped;i++){
            			        var amount = 10000
            			        var cost = Game.market.calcTransactionCost(amount, name, keys[i]);
            			        if(cost < amount){
            			            room.terminal.send(RESOURCE_ENERGY, amount, keys[i], "Support");
            			            notHelped = false;
            			        }
        			        }
        			    }
        			    if(room.terminal.store.energy > 150000){
            			    var amount = 10000;
                			var orders = Game.market.getAllOrders(order => order.resourceType == RESOURCE_ENERGY && 
            	                order.type == ORDER_BUY && 
                                Game.market.calcTransactionCost(amount, name, order.roomName) < amount*2);
                            if(orders.length){
                                var bestOrder = orders[0];
                                orders.forEach(function(order){
                                    //if(order.price > bestOrder.price){
                                    if((order.price*order.amount)/Game.market.calcTransactionCost(order.amount, name, order.roomName)
                                        > (bestOrder.price*order.amount)/Game.market.calcTransactionCost(bestOrder.amount, name, bestOrder.roomName)){
                                        bestOrder = order;
                                    }
                                });
                                var amount = Math.min(100000,Math.min(bestOrder.amount,bestOrder.remainingAmount));
                                Game.market.deal(bestOrder.id,amount,name);
                            }
        			    }
        			}
        			//Market End
    		    }
    		
    		}else{
    		    delete room.memory;
    			delete Memory.myRooms[name];
    		}
    	}
    	
    	//Kendalor Code
        if (Game.cpu.bucket > 2000){
    	    operationsHandler.init();
    	    operationsHandler.run();
        }
    
    	if(Game.time % 500 == 0){
    		autoMemory.clearDeadCreeps();
    		//autoMemory.clearFlags();
    	}
    	
    }
}/**/