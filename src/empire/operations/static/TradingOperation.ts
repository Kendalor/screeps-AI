import { OperationsManager } from "empire/OperationsManager";
import { Operation } from "../Operation";










export class TradingOperation extends Operation{


    constructor(name: string, manager: OperationsManager, entry: IOperationMemory) {
        super(name, manager,entry);
        this.type = OPERATION.TRADING;
        if(this.data.todo == null){
            this.data.todo = [];
        }
    }


    public run() {
        console.log(Game.shard.name + ": TradingManager");
        super.run();
        const terminals = [];
        for(const i in Game.rooms){
            const room = Game.rooms[i];
            if(room != null && room.terminal != null){
                this.sellSomething(room.terminal);
            }
        }
        this.pause = 1000;
    }

    private sellSomething(t: StructureTerminal){
        if(t.store.getFreeCapacity() <= 5000){
            this.makeDeal(t);
        } else {
            if(t.store.getUsedCapacity(RESOURCE_ENERGY) >= 100000){
                const orders = Object.keys(Game.market.orders).filter(key => Game.market.orders[key].roomName === t.room.name &&
                    Game.market.orders[key].type === ORDER_SELL && Game.market.orders[key].resourceType === RESOURCE_ENERGY).pop();
                if(orders != null){
                    const order = Game.market.orders[orders];
                    if(order != null){
                        if(order.active === false){
                            Game.market.cancelOrder(order.id);
                        }
                    }
                    // UPDATE
                } else {
                    const sellprice =this.getSellPrice(t,RESOURCE_ENERGY);
                    if(sellprice != null){
                        const amount = Math.floor(t.store.getUsedCapacity(RESOURCE_ENERGY)-50000);
                        Game.market.createOrder({type: ORDER_SELL, roomName: t.room.name, resourceType: RESOURCE_ENERGY, totalAmount: amount,price: sellprice });
                    }
                }
            }
        }
    }

    private makeDeal(t: StructureTerminal): void {
        const orders = Game.market.getAllOrders( o => o.type === ORDER_BUY && o.resourceType === RESOURCE_ENERGY);
        if(orders.length > 0){
            const bestPrice = orders.sort( (a,b) =>  (a.price) -(b.price));
            console.log(JSON.stringify(bestPrice));
            const order = bestPrice.pop();
            if(order != null){
                Game.market.deal(order.id,Math.min(order.amount,Math.floor(t.store.getUsedCapacity(RESOURCE_ENERGY)/2)),t.room.name);
            }
        }
    }


    private getSellPrice(t: StructureTerminal, res: ResourceConstant): number | undefined {
        const history = Game.market.getHistory(RESOURCE_ENERGY).pop();
        if(history != null){
            return history.avgPrice-history.stddevPrice;
        }
        return undefined;
    }




}