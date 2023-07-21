import { opFactory } from "utils/operationFactory";
import { EmpireManager } from "./EmpireManager";
import { InitialRoomOperation } from "./operations/Operations/InitialBuildUpPhase/InitRoomOperation";





export class OperationsManager implements IOperationsManager {

	public empire: EmpireManager;
	private operations: {[id: string]: IOperation} = {};
	private operationsTodo: Array<[string, IOperation]> = new Array<[string, IOperation]>();

    constructor(emp: EmpireManager) {
		this.empire=emp;
		if(Memory.empire.operations== null){
			Memory.empire.operations = {};
		}
	}
	/**
	 * Start of Tick Method
	 */

	public init(): void {
		this.loadOperationList();
	}
	/**
	 * Run Method executed per tick
	 */
    public run(): void {


		let counter =0;
		while( this.hasNextOperation()) {
				this.runNextOperation();
			counter = counter +1;
		}

		this.destroy();

		
	}
	/**
	 * End of Tick Method
	 */
	public destroy(): void {
		this.saveOperationList();
	}

	public getOperationsOfType<T extends IOperation>(type: OPERATION): T[]{
		const out = new Array<T>();
		for(const op of Object.keys(this.operations)){
			if(this.operations[op].type === type){
				out.push(this.operations[op] as T);
			}
		}
		return out;
	}

	public getBaseOperations(): InitialRoomOperation[] {
		return this.getOperationsOfType<InitialRoomOperation>(OPERATION.BASE);
	}



	/**
	 * Run the next runable RoomOperation in the operations List with the highest Priority
	 */
    private runNextOperation(): void {
		const op = this.getNextOperation();
		if( op !== undefined ) {
			if(Game.cpu.getUsed() < Game.cpu.tickLimit *0.8) {
				const time = Game.cpu.getUsed();
				try{
					op.run();
					this.empire.stats.addOp( Game.cpu.getUsed() - time, op.type);
				} catch(error){
					op.didRun=true;
					console.log("Failed to Run Op: " + op.name + " with parse: " + JSON.stringify(op.data));
					console.log(JSON.stringify(error));
				}

			} else {
				console.log("Skipped OP because empty Bucket");
			}



		}
	}


	public getOpCount(): number {
		return Object.keys(this.operations).length;
	}

	private getNextOperation(): IOperation | undefined {
		if(this.hasNextOperation()){
			const temp = this.operationsTodo.pop();
			if( temp != null ){
				return temp[1];
			} else {
				return undefined;
			}
		} else {
			return undefined;
		}
	}
	private hasNextOperation(): boolean {
		return this.operationsTodo.length > 0;
	}

	/**
 	* Load Operations from Memory
	 */
    private loadOperationList(): void {
		
		this.operations = {};
		if(Memory.empire.operations == null){
			Memory.empire.operations = {};
		}
        for(const i of Object.keys(Memory.empire.operations)) {
			try {
				const op = opFactory(i, this, Memory.empire.operations[i] as IOperationMemory);
				if(op != null){
					this.operations[i]= op;
				} else {
					console.log("INVALID OPERATION WITH TYPE: " +Memory.empire.operations[i].type + " DELETED" );
					delete Memory.empire.operations[i];
				}
			} catch (error) {
				console.log("Error for Operation: " + i + "of type:  with Error: " +error);
			}
			

            
		}

		this.operationsTodo = Object.entries(this.operations).filter( entry => entry[1].pause === 0 && entry[1].didRun === false).sort( (entryA,entryB) => entryA[1].priority - entryB[1].priority);
    }
    /**
     * Save Operations to Memory
     */
    private saveOperationList(): void {
		Memory.empire.operations = {};
		global.logger.debug("Saving Operations List of Lengh: " + Object.keys(this.operations).length);
        for(const key of Object.keys(this.operations)) {
			if(this.operations[key].pause > 0){
				this.operations[key].pause = this.operations[key].pause -1;
			}
			Memory.empire.operations[key] = this.operations[key].toMemory() as IOperationMemory;
		}
		global.logger.debug("Saved Operations: " + Object.keys(Memory.empire.operations).length);
	}

	private generateName(): string {
        return Math.random().toString(36).substr(8);
    }


    /**
     * push a new RoomOperation into the operations List of the RoomManager
     * @param entry RoomOperation
     */
    public enque(entry: IOperationMemory){
		const name = this.generateName();
		const op = opFactory(name, this, entry as IOperationMemory);
		if( op !== undefined){
			this.operations[name]=op;
		}
		return name;
	}
	
    /**
     * remove a new RoomOperation from the operations List of the RoomManager
     * @param entry RoomOperationMemoryInterface
     */

	public entryExists(name: string ): boolean{
		return this.operations[name] != null;
	}

	public getEntryByName<T extends IOperation>(name: string): T | null {
		if(this.entryExists(name)){
			return this.operations[name] as T;
		} else {
			return null;
		}
	}

    public dequeue(name: string){
       delete this.operations[name];
    }
}