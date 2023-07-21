import { defaultsDeep } from "lodash";



let lastMemory: any;
let lastTick: number =0;

export class MemoryUtil {



    static load() {
		if (lastTick && lastMemory && Game.time == lastTick + 1) {
			delete global.Memory;
			global.Memory = lastMemory;
			RawMemory._parsed = lastMemory;
		} else {
			// noinspection BadExpressionStatementJS
			/* tslint:disable:no-unused-expression */
			Memory.rooms; // forces parsing
			/* tslint:enable:no-unused-expression */
			lastMemory = RawMemory._parsed;
		}
		lastTick = Game.time;
		// Handle global time

	}

    static wrap(memory: any, memName: string, defaults =  {}, deep= false ){
        if(!memory[memName]){
            memory[memName]= _.clone(defaults);
        }
        if(deep){
            _,defaultsDeep(memory[memName],defaults);
        } else {
            _.defaults(memory[memName],defaults);
        }
        return memory;
    }

}