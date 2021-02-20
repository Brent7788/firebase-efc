import firebase from "firebase/app";
import "firebase/auth";
import "firebase/firestore";
import DbFirestore from "./DbFirestore";
import AbstractEntity from "./entities/AbstractEntity";

export default class DbContext {

    private readonly db;
    private auth;
    private readonly batch;
    //private dbSetFieldNames = DecoratorTool.getMyPropertyDecoratorValues(this.constructor, "DbSet");
    private dbSetFieldNames: string[] = [];
    private fetchTimeOut = 3000;
    private check: any;
    private longRunningThread = false;

    public writeError = false;

    constructor(firebaseConfig: any | undefined = undefined) {
        if (firebaseConfig)
            firebase.initializeApp(firebaseConfig);

        this.db = firebase.firestore();
        this.auth = firebase.auth();
        this.batch = this.db.batch();
    }

    protected initializeDbFireStore(types: (new () => any)[]): void {
        if (types) {
            for (const type of types) {
                let entity = new type();
                /*for (let dbSetName of this.dbSetFieldNames) {
                    console.log(dbSetName, entity.constructor.name);
                    if (entity.constructor.name === this.capitalizeFirstLetter(dbSetName)) {
                        (<any>this)[dbSetName] = new DbFirestore(type, entity, this.db, this.batch);
                    }
                }*/
                const dbSetFieldName = this.lowercaseFirstLetter(entity.constructor.name);
                console.log(dbSetFieldName);
                (<any>this)[dbSetFieldName] = new DbFirestore(type, entity, this.db, this.batch);
                this.dbSetFieldNames.push(dbSetFieldName);
            }
        }
    }

    public set<T extends AbstractEntity>(entity: T | undefined, wait = false): void {

        this.validateEntityBeforeWrite(entity);

        this.shouldWait(wait, () => {
            const ref = this.db.collection((<T>entity).constructor.name)
                .doc((<T>entity).id);

            this.batch.set(ref, (<T>entity).asObject());
        });
    }

    private update<T extends AbstractEntity>(entity: T | undefined): void {

        this.validateEntityBeforeWrite(entity);

        const ref = this.db.collection((<T>entity).constructor.name)
            .doc((<T>entity).id);

        this.batch.update(ref, (<T>entity).asObject());
    }

    public delete<T extends AbstractEntity>(entity: T | undefined): void {

        this.validateEntityBeforeWrite(entity);

        const ref = this.db.collection((<T>entity).constructor.name)
            .doc((<T>entity).id);

        this.batch.delete(ref);
    }

    //TODO There is a problem with long running code that is going to be updated
    //     It does not update
    public handleLongRunningCode(running: () => Promise<void>): void {
        this.longRunningThread = true;

        running().then(value => {
            console.log('AM I DONE', value);
            this.longRunningThread = false;
        }).catch(error => {
            this.writeError = true;
            this.longRunningThread = false;
            console.error(error);
        })
    }

    public async saveChangesAsync() {
        let test = 0;
        return new Promise<boolean>((resolve, reject) => {
            try {
                const dbSets = this.getDbSets().filter(dbSet => dbSet);

                if (dbSets.length === 0)
                    reject("There is no entities to save");

                setTimeout(() => {
                    clearInterval(this.check);
                }, this.fetchTimeOut);

                let alreadyCommitted = false;
                //TODO This mite not be a good idea
                this.check = setInterval(async () => {
                    try {
                        /*test++;
                        console.log("hello", test, this.writeError, alreadyCommitted, this.longRunningThread);*/
                        if (!this.longRunningThread && !alreadyCommitted) {
                            const stillRun = dbSets.filter(dbSet => dbSet.isRunConcurrently);

                            if (stillRun.length === 0 && !alreadyCommitted) {

                                this.updateObservableEntities(dbSets);

                                if (!this.writeError && !alreadyCommitted) {
                                    alreadyCommitted = true;
                                    await this.batch.commit()
                                    resolve(true);
                                }
                                clearInterval(this.check);
                            }
                        }
                    } catch (error) {
                        clearInterval(this.check);
                        reject(`Unable to save changes, ${error}`);
                    }
                }, 50);
            } catch (error) {
                reject(`Unable to save changes, ${error}`)
            }
        });
    }

    private getDbSets(): DbFirestore<any>[] {
        return this.dbSetFieldNames.map(dbSetFieldName => <DbFirestore<any>>(<any>this)[dbSetFieldName]);
    }

    private updateObservableEntities(dbSets: DbFirestore<any>[]): void {
        const entitiesToUpdate = dbSets
            .map(dbSet => dbSet.observableEntities.filter(o => o.haveEntityChanged))
            .flat();

        for (const entitiesToUpdateElement of entitiesToUpdate) {
            this.update(entitiesToUpdateElement.entity);
        }
    }

    private validateEntityBeforeWrite<T extends AbstractEntity>(entity: T | undefined) {
        if (!entity) {
            this.writeError = true;
            //TODO Improve error message
            throw new Error(`Please provide entity to write`);
        }

        if (!entity.id) {
            this.writeError = true;
            throw new Error(`Entity(${(<T>entity).constructor.name}) doesn't have unique identifier(id)`);
        }
    }

    //TODO This is workaround for firebase bug. Data wound save in async function or call back function.
    //     after waiting for one second, then data save.
    private shouldWait(wait: boolean, func: () => void): void {
        if (wait) {
            setTimeout(func, 1000);
        } else {
            func();
        }
    }

    private lowercaseFirstLetter(str: any): string {
        return str.charAt(0).toLowerCase() + str.slice(1);
    }
}