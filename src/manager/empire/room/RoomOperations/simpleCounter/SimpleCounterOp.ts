import { RoomManager } from "../../RoomManager";
import { RoomOperation } from "../RoomOperation";
import { RoomOperationMemoryInterface } from "../RoomOperationMemoryInterface";



export class SimpleCounter extends RoomOperation{
 
    constructor(mgr: RoomManager, entry: RoomOperationMemoryInterface){
        super(mgr,entry);
        this.type = "SimpleCounter";
    }

    public run() {
        if(this.firstRun){
            this.onfirstRun();
        }
        console.log("Incrementing Counter: " + this.data.counter );
        this.data.counter = this.data.counter +1;
        this.didRun = true;
        if(this.data.counter > 10) {
            this.onlastRun();
        }
        // TODO
    }

    public onfirstRun() {
        super.onfirstRun();
        console.log("INitialized COunter");
        this.data.counter = 0;
        
        // TODO
    }

}