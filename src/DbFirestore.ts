import firebase from "firebase/app";
import "firebase/firestore";
import AbstractEntity from "./entities/AbstractEntity";
import {ConditionState, Expresion, ExpresionBuilder} from "./tools/ExpresionBuilder";
import CollectionReference = firebase.firestore.CollectionReference;
import DocumentData = firebase.firestore.DocumentData;
import WhereFilterOp = firebase.firestore.WhereFilterOp;
import Query = firebase.firestore.Query;
import Firestore = firebase.firestore.Firestore;
import WriteBatch = firebase.firestore.WriteBatch;
import Condition from "./tools/Condition";

//TODO Do not push this
const firebaseConfig = {
    apiKey: "AIzaSyBMD1RAOIUVes_0ztO2c0oIjpElwpvL6Ck",
    authDomain: "first-look-talent.firebaseapp.com",
    projectId: "first-look-talent",
    storageBucket: "first-look-talent.appspot.com",
    messagingSenderId: "249876831683",
    appId: "1:249876831683:web:51da092eb11e982203f176"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

export default class DbFirestore<T extends AbstractEntity> {

    private db: Firestore;
    private readonly batch: WriteBatch;
    private entity: T;
    private readonly type: (new () => T);
    private readonly entityName: string;
    private readonly collectionRef: CollectionReference<DocumentData>;
    private queries: Query<DocumentData>[] = [];

    public writeError = false;
    //TODO Find better name for this
    public isInConcurrently = false;

    constructor(type: (new () => T), entity: T, db: Firestore, batch: WriteBatch) {
        this.type = type;
        this.entity = entity;
        this.entityName = entity.constructor.name;
        this.db = db;
        this.batch = batch;
        this.collectionRef = this.db.collection(this.entityName);
    }

    public where(expresion: (entity: T) => ExpresionBuilder): DbFirestore<T> {
        this.isInConcurrently = true;
        this.setQueries(expresion(this.entity).prosesExpresionSet());
        return this;
    }

    public async firstOrDefaultAsync(expresion: (entity: T) => ExpresionBuilder): Promise<T | undefined> {
        this.isInConcurrently = true;
        const exp: ExpresionBuilder = expresion(this.entity).prosesExpresionSet();

        if (exp.conditionState === ConditionState.START &&
            exp.orExpressions.length === 1 &&
            Condition.stringContain(exp.orExpressions[0].field, "id")) {

            const documentReference = this.collectionRef.doc(exp.orExpressions[0].value);
            const documentSnapshot = await documentReference.get();

            if (!documentSnapshot.exists) {
                return undefined;
            } else {
                return Object.assign(new this.type(), documentSnapshot.data());
            }
        } else {
            this.setQueries(exp);
        }
        const entities = await this.toListAsync();

        return (entities.length !== 0) ? entities[0] : undefined;
    }

    public async toListAsync(): Promise<T[]> {

        const entities: T[] = [];
        const querySnapshotPromises = this.queries.map(q => q.get());

        console.log(this.queries.length);

        //TODO Object.assign(new this.type(), doc.data()) only works for primitive fields in that entity
        //     objects in the entity will be undefined
        for await (const querySnapshot of querySnapshotPromises) {
            for (const doc of (await querySnapshot).docs) {
                entities.push(Object.assign(new this.type(), doc.data()));
            }
        }

        this.queries = [];
        this.isInConcurrently = false;
        return entities;
    }


    public set(entity: T | undefined, wait = false): void {

        this.validateEntityBeforeWrite(entity);

        this.shouldWait(wait, () => {
            const ref = this.collectionRef
                .doc((<T>entity).id);

            this.batch.set(ref, (<T>entity).asObject());
        });
    }

    public update(entity: T | undefined): void {

        this.validateEntityBeforeWrite(entity);

        const ref = this.collectionRef
            .doc((<T>entity).id);

        this.batch.update(ref, (<T>entity).asObject());
    }

    public delete(entity: T | undefined): void {

        this.validateEntityBeforeWrite(entity);

        const ref = this.collectionRef
            .doc((<T>entity).id);

        this.batch.delete(ref);
    }

    private validateEntityBeforeWrite(entity: T | undefined) {
        if (!entity) {
            this.writeError = true;
            throw new Error(`Please provide entity(${this.entityName})`);
        }

        if (!entity.id) {
            this.writeError = true;
            throw new Error(`Entity(${this.entityName}) doesn't have unique identifier(id)`);
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

    private setQueries(exp: ExpresionBuilder): void {

        if (exp.conditionState === ConditionState.START && exp.andExpresionGroup.length === 0) {

            const expressionObj = exp.orExpressions[0];
            this.queries.push(this.collectionRef.where(expressionObj.field, <WhereFilterOp>expressionObj.operator, expressionObj.value));

        }

        if (exp.andExpresionGroup.length > 0 && this.queries.length === 0) {
            let expressions: Expresion[];
            let queryIndex = 0;
            for (const expresionGroup of exp.andExpresionGroup) {

                expressions = expresionGroup.expressions;

                for (const expressionObj of expressions) {
                    if (this.queries[queryIndex]) {
                        this.queries[queryIndex] = this.queries[queryIndex].where(expressionObj.field, <WhereFilterOp>expressionObj.operator, expressionObj.value);
                    } else {
                        this.queries[queryIndex] = this.collectionRef.where(expressionObj.field, <WhereFilterOp>expressionObj.operator, expressionObj.value);
                    }
                }
                queryIndex++;
            }
        }

        if (exp.orExpressions.length > 0) {
            for (const orExpression of exp.orExpressions) {
                this.queries.push(this.collectionRef.where(orExpression.field, <WhereFilterOp>orExpression.operator, orExpression.value));
            }
        }
    }
}