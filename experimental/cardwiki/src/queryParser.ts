import * as microReact from "./microReact";
import * as runtime from "./runtime";
import {eve} from "./app";
import * as app from "./app";
import * as wiki from "./wiki";

declare var pluralize;
declare var uuid;

window["eve"] = eve;

//---------------------------------------------------------
// Token types
//---------------------------------------------------------

enum TokenTypes {
  entity,
  collection,
  attribute,
  modifier,
  pattern,
  value,
  text,
}

//---------------------------------------------------------
// Modifiers
//---------------------------------------------------------

var modifiers = {
  "and": {and: true},
  "or": {or: true},
  "without": {deselected: true},
  "aren't": {deselected: true},
  "don't": {deselected: true},
  "per": {group: true},
  ",": {separator: true},
  "all": {every: true},
  "every": {every: true},
};

//---------------------------------------------------------
// Patterns
//---------------------------------------------------------

function closestAttribute(cursor) {
  for(let ix = cursor.children.length; ix > -1; ix--) {
    let node = cursor.children[ix];
    if(node.type === TokenTypes.attribute) {
      return node;
    }
  }
  return;
}

var patterns = {
  "older": {
    type: "rewrite",
    rewrites: [{attribute: "age", text: "age >"}],
  },
  "younger": {
    type: "rewrite",
    rewrites: [{attribute: "age", text: "age <"}],
  },
  "cheaper": {
    type: "rewrite",
    rewrites: [{attribute: "price", text: "price <"}, {attribute: "cost", text: "cost <"}]
  },
  "greater than": {
    type: "rewrite",
    rewrites: [{text: ">"}],
  },
  "years old": {
    type: "rewrite",
    rewrites: [{attribute: "age", text: "age"}],
  },
  "sum" :{
    type: "aggregate",
    op: "sum",
    // sum sales per person
    // sum sales
    // people whose sum of sales is < 10
    getArgs: (tokens, tokenIx, cursor) => {
      console.log(cursor);
    }
  },
  "top": {
    type: "filter",
    op: "<",
    getArgs: (tokens, tokenIx, cursor, tree) => {

    }
  },
  "<": {
    type: "filter",
    op: "<",
    getArgs: (tokens, tokenIx, cursor, tree) => {

    }
  },
  ">": {
    type: "filter",
    op: "<",
    getArgs: (tokens, tokenIx, cursor) => {
      // let left = closestAttribute(cursor);
      // console.log(cursor);
      // return [left, ];
    }
  },
};

//---------------------------------------------------------
// Tokenizer
//---------------------------------------------------------

function checkForToken(token): any {
  var found;
  if(!token) return {};
  if(found = eve.findOne("collection", {collection: token})) {
    return {found, type: TokenTypes.collection};
  } else if(found = eve.findOne("entity", {entity: token})) {
    return {found, type: TokenTypes.entity};
  } else if(found = eve.findOne("entity eavs", {attribute: token})) {
    return {found, type: TokenTypes.attribute};
  } else if(found = modifiers[token]) {
    return {found, type: TokenTypes.modifier};
  } else if(found = patterns[token]) {
    return {found, type: TokenTypes.pattern};
  } else if(token.match(/^-?[\d]+$/gm)) {
    return {type: TokenTypes.value, found: JSON.parse(token), valueType: "number"};
  } else if(token.match(/^["][^"]*["]$/gm)) {
    return {type: TokenTypes.value, found: JSON.parse(token), valueType: "string"};
  } else if(found = token.match(/^([\d]+)-([\d]+)$/gm)) {
    return {type: TokenTypes.value, found: token, valueType: "range", start: found[1], stop: found[2]};
  }
  return {};
}

function getTokens(string) {
  // remove all non-word non-space characters
  let cleaned = string.replace(/'s/gi, "  ").toLowerCase();
  cleaned = cleaned.replace(/[,.?!]/gi, " , ");
  let words = cleaned.split(" ");
  let front = 0;
  let back = words.length;
  let results = [];
  let pos = 0;
  while(front < words.length) {
    let str = words.slice(front, back).join(" ");
    let orig = str;
    var {found, type} = checkForToken(str);
    if(!found) {
      str = pluralize(str, 1);
      var {found, type} = checkForToken(str);
      if(!found) {
        str = pluralize(str, 2);
        var {found, type} = checkForToken(str);
      }
    }
    if(found) {
      results.push({found: str, orig, pos, type, info: found, id: uuid(), children: []});
      front = back;
      pos += orig.length + 1;
      back = words.length;
    } else if(back - 1 > front) {
      back--;
    } else {
      if(orig) {
        results.push({found: orig, orig, pos, type: TokenTypes.text});
      }
      back = words.length;
      pos += words[front].length + 1;
      front++;
    }
  }
  return results;
}

//---------------------------------------------------------
// Relationships between tokens
//---------------------------------------------------------

enum RelationshipTypes {
  none,
  entityToEntity,
  entityToAttribute,
  collectionToCollection,
  collectionIntersection,
  collectionToEntity,
  collectionToAttribute,
}

var tokenRelationships = {
  [TokenTypes.collection]: {
    [TokenTypes.collection]: findCollectionToCollectionRelationship,
    [TokenTypes.entity]: findCollectionToEntRelationship,
    [TokenTypes.attribute]: findCollectionToAttrRelationship,
  },
  [TokenTypes.entity]: {
    [TokenTypes.entity]: findEntToEntRelationship,
    [TokenTypes.attribute]: findEntToAttrRelationship,
  },
}

function determineRelationship(parent, child) {
  if(!tokenRelationships[parent.type] || !tokenRelationships[parent.type][child.type]) return {distance: Infinity, type: RelationshipTypes.none};
  return tokenRelationships[parent.type][child.type](parent.found, child.found);
}

function entityTocollectionsArray(entity) {
  let entities = eve.find("collection entities", {entity});
  return entities.map((a) => a["collection"]);
}

function extractFromUnprojected(coll, ix, field, size) {
  let results = [];
  for(var i = 0, len = coll.length; i < len; i += size) {
    results.push(coll[i + ix][field]);
  }
  return results;
}

function findCommonCollections(ents) {
  let intersection = entityTocollectionsArray(ents[0]);
  intersection.sort();
  for(let entId of ents.slice(1)) {
    let cur = entityTocollectionsArray(entId);
    cur.sort();
    arrayIntersect(intersection, cur);
  }
  intersection.sort((a, b) => {
    return eve.findOne("collection", {collection: b})["count"] - eve.findOne("collection", {collection: a})["count"];
  })
  return intersection;
}

function findEntToEntRelationship(ent, ent2) {
  return {distance: Infinity, type: RelationshipTypes.entityToEntity};
}

// e.g. "salaries in engineering"
// e.g. "chris's age"
function findEntToAttrRelationship(ent, attr):any {
  // check if this ent has that attr
  let directAttribute = eve.findOne("entity eavs", {entity: ent, attribute: attr});
  if(directAttribute) {
    return {distance: 0, type: RelationshipTypes.entityToAttribute};
  }
  let relationships = eve.query(``)
                .select("entity links", {entity: ent}, "links")
                .select("entity eavs", {entity: ["links", "link"], attribute: attr}, "eav")
                .exec();
  if(relationships.unprojected.length) {
    let entities = extractFromUnprojected(relationships.unprojected, 0, "link", 2);
    return {distance: 1, type: RelationshipTypes.entityToAttribute, nodes: [findCommonCollections(entities)]};
  }
  let relationships2 = eve.query(``)
                .select("entity links", {entity: ent}, "links")
                .select("entity links", {entity: ["links", "link"]}, "links2")
                .select("entity eavs", {entity: ["links2", "link"], attribute: attr}, "eav")
                .exec();
  if(relationships2.unprojected.length) {
    let entities = extractFromUnprojected(relationships2.unprojected, 0, "link", 3);
    let entities2 = extractFromUnprojected(relationships2.unprojected, 1, "link", 3);
    return {distance: 2, type: RelationshipTypes.entityToAttribute, nodes: [findCommonCollections(entities), findCommonCollections(entities2)]};
  }

  //otherwise we assume it's direct and mark it as unfound.
  return {distance: 0, type: RelationshipTypes.entityToAttribute, unfound: true};
}

// e.g. "salaries per department"
function findCollectionToAttrRelationship(coll, attr) {
  let direct = eve.query(``)
                .select("collection entities", {collection: coll}, "collection")
                .select("entity eavs", {entity: ["collection", "entity"], attribute: attr}, "eav")
                .exec();
  if(direct.unprojected.length) {
    return {distance: 0, type: RelationshipTypes.collectionToAttribute, nodes: []};
  }
  let relationships = eve.query(``)
                .select("collection entities", {collection: coll}, "collection")
                .select("directionless links", {entity: ["collection", "entity"]}, "links")
                .select("entity eavs", {entity: ["links", "link"], attribute: attr}, "eav")
                .exec();
  if(relationships.unprojected.length) {
    let entities = extractFromUnprojected(relationships.unprojected, 1, "link", 3);
    return {distance: 1, type: RelationshipTypes.collectionToAttribute, nodes: [findCommonCollections(entities)]};
  }
  let relationships2 = eve.query(``)
                .select("collection entities", {collection: coll}, "collection")
                .select("directionless links", {entity: ["collection", "entity"]}, "links")
                .select("directionless links", {entity: ["links", "link"]}, "links2")
                .select("entity eavs", {entity: ["links2", "link"], attribute: attr}, "eav")
                .exec();
  if(relationships2.unprojected.length) {
    let entities = extractFromUnprojected(relationships2.unprojected, 1, "link", 4);
    let entities2 = extractFromUnprojected(relationships2.unprojected, 2, "link", 4);
    return {distance: 2, type: RelationshipTypes.collectionToAttribute, nodes: [findCommonCollections(entities), findCommonCollections(entities2)]};
  }
}

// e.g. "meetings john was in"
function findCollectionToEntRelationship(coll, ent):any {
  if(coll === "collections") {
    if(eve.findOne("collection entities", {entity: ent})) {
      return {distance: 0, type: "ent->collection"};
    }
  }
  if(eve.findOne("collection entities", {collection: coll, entity: ent})) {
    return {distance: 0, type: RelationshipTypes.collectionToEntity, nodes: []};
  }
  let relationships = eve.query(``)
                .select("collection entities", {collection: coll}, "collection")
                .select("directionless links", {entity: ["collection", "entity"], link: ent}, "links")
                .exec();
  if(relationships.unprojected.length) {
    return {distance: 1, type: RelationshipTypes.collectionToEntity, nodes: []};
  }
  // e.g. events with chris granger (events -> meetings -> chris granger)
  let relationships2 = eve.query(``)
                .select("collection entities", {collection: coll}, "collection")
                .select("directionless links", {entity: ["collection", "entity"]}, "links")
                .select("directionless links", {entity: ["links", "link"], link: ent}, "links2")
                .exec();
  if(relationships2.unprojected.length) {
    let entities = extractFromUnprojected(relationships2.unprojected, 1, "link", 3);
    return {distance: 2, type: RelationshipTypes.collectionToEntity, nodes: [findCommonCollections(entities)]};
  }
}

// e.g. "authors and papers"
function findCollectionToCollectionRelationship(coll, coll2) {
  // are there things in both sets?
  let intersection = eve.query(`${coll}->${coll2}`)
                    .select("collection entities", {collection: coll}, "coll1")
                    .select("collection entities", {collection: coll2, entity: ["coll1", "entity"]}, "coll2")
                    .exec();
  //is there a relationship between things in both sets
  let relationships = eve.query(`relationships between ${coll} and ${coll2}`)
                .select("collection entities", {collection: coll}, "coll1")
                .select("directionless links", {entity: ["coll1", "entity"]}, "links")
                .select("collection entities", {collection: coll2, entity: ["links", "link"]}, "coll2")
                .group([["links", "type"]])
                .aggregate("count", {}, "count")
                .project({type: ["links", "type"], count: ["count", "count"]})
                .exec();

  let maxRel = {count: 0};
  for(let result of relationships.results) {
    if(result.count > maxRel.count) maxRel = result;
  }

  // we divide by two because unprojected results pack rows next to eachother
  // and we have two selects.
  let intersectionSize = intersection.unprojected.length / 2;
  if(maxRel.count > intersectionSize) {
    return {distance: 1, type: RelationshipTypes.collectionToCollection};
  } else if(intersectionSize > maxRel.count) {
    return {distance: 0, type: RelationshipTypes.collectionIntersection};
  } else if(maxRel.count === 0 && intersectionSize === 0) {
    return;
  } else {
    return {distance: 1, type: RelationshipTypes.collectionToCollection};
  }
}

//---------------------------------------------------------
// Token tree
//---------------------------------------------------------

function tokensToTree(origTokens) {
  let tokens = origTokens;
  let roots = [];
  let operations = [];
  let groups = [];
  // Find the direct object
  // The direct object is the first collection we find, or if there are none,
  // the first entity, or finally the first attribute.
  let directObject;
  for(let token of tokens) {
    if(token.type === TokenTypes.collection) {
      directObject = token;
      break;
    } else if(token.type === TokenTypes.entity) {
      directObject = token;
    } else if(token.type === TokenTypes.attribute && !directObject) {
      directObject = token;
    }
  }

  let tree = {directObject, roots, operations, groups};
  if(!directObject) return tree;

  // the direct object is always the first root
  roots.push(directObject);
  // we need to keep state as we traverse the tokens for modifiers and patterns
  let state = {};
  // as we parse the query we may encounter other subjects in the sentence, we
  // need a reference to those previous subjects to see if the current token is
  // related to that or the directObject
  let indirectObject = directObject;

  for(let tokenIx = 0, len = tokens.length; tokenIx < len; tokenIx++) {
    let token = tokens[tokenIx];
    let {type, info, found} = token;

    // deal with modifiers
    if(type === TokenTypes.modifier) {
      // if this is a deselect modifier, we need to roll forward through the tokens
      // to figure out roughly how far the deselection should go. Also if we run into
      // an and or an or, we need to deal with that specially.
      if(info.deselected) {
        // we're going to move forward from this token and deselect as we go
        let localTokenIx = tokenIx + 1;
        // get to the first non-text token
        while(localTokenIx < len && tokens[localTokenIx].type === TokenTypes.text) {
          localTokenIx++;
        }
        // negate until we find a reason to stop
        while(localTokenIx < len) {
          let localToken = tokens[localTokenIx];
          if(localToken.type === TokenTypes.text) {
            break;
          }
          localToken.deselected = true;
          localTokenIx++;
        }
      }
      // if we're dealing with an "or" we have two cases, we're either dealing with a negation
      // or a split. If this is a deselected or, we don't really need to do anything because that
      // means we just do a deselected join. If it's not negated though, we're now dealing with
      // a second query context. e.g. people who are employees or spouses of employees
      if(info.or && !token.deslected) {
        let localTokenIx = tokenIx + 1;
        // get to the first non-text token
        while(localTokenIx < len && tokens[localTokenIx].type === TokenTypes.text) {
          localTokenIx++;
        }
        // consume until we hit a separator
        while(localTokenIx < len) {
          let localToken = tokens[localTokenIx];
          if(localToken.type === TokenTypes.text) {
            break;
          }
          localTokenIx++;
        }
      }
      // a group adds a group for the next collection and checks to see if there's an and
      // or a separator that would indicate multiple groupings
      if(info.group) {
        // we're going to move forward from this token and deselect as we go
        let localTokenIx = tokenIx + 1;
        // get to the first non-text token
        while(localTokenIx < len && tokens[localTokenIx].type === TokenTypes.text) {
          localTokenIx++;
        }
        // if we've run out of tokens, bail
        if(localTokenIx === len) break;
        // otherwise, the next thing we found is what we're trying to group by
        let localToken = tokens[localTokenIx];
        localToken.grouped = true;
        groups.push(localToken);
        localTokenIx++;
        // now we have to check if we're trying to group by multiple things, e.g.
        // "per department and age" or "per department, team, and age"
        let next = tokens[localTokenIx];
        while(next && next.type === TokenTypes.modifier && (next.info.separator || next.info.and)) {
          localTokenIx++;
          next = tokens[localTokenIx];
          // if we have another modifier directly after (e.g. ", and") loop again
          // to see if this is valid.
          if(next && next.type === TokenTypes.modifier) {
            continue;
          }
          next.grouped = true;
          groups.push(next);
          localTokenIx++;
          next = tokens[localTokenIx];
        }
      }
      continue;
    }
    // deal with patterns
    if(type === TokenTypes.pattern) {
      if(info.type === "rewrite") {
        let newText;
        // if we only have one possible rewrite, we can just take it
        if(info.rewrites.length === 1) {
          newText = info.rewrites[0].text;
        } else {
          // @TODO: we have to go through every possibility and deal with it
          newText = info.rewrites[0].text;
        }
        // Tokenize the new string
        let newTokens = getTokens(newText);
        // Splice in the new tokens, adjust the length and make sure we revisit this token.
        len += newTokens.length;
        tokens.splice.apply(tokens, [tokenIx+1, 0].concat(newTokens));
        // apply any deselects, or's, or and's to this token
        for(let newToken of newTokens) {
          newToken.deselected = token.deselected;
          newToken.and = token.and;
          newToken.or = token.or;
        }
        continue;
      } else if(info.type === "aggregate") {
        let args = token.info.getArgs(tokens, tokenIx, indirectObject);
        token.args = args;
        operations.push(token);
      } else if(info.type === "filter") {
        let args = token.info.getArgs(tokens, tokenIx, indirectObject);
        token.args = args;
        operations.push(token);
      }
      continue;
    }

    // deal with values
    if(type === TokenTypes.value) {
      continue;
    }

    // once modifiers and patterns have been applied, we don't need to worry
    // about the directObject as it's already been asigned to the first root.
    if(directObject === token || type === TokenTypes.text) continue;

    if(directObject === indirectObject) {
      directObject.children.push(token);
      token.relationship = determineRelationship(directObject, token);
      token.parent = directObject;
      indirectObject = token;
    } else {
      let potentialParent = indirectObject;
      // if our indirect object is an attribute and we encounter another one, we want to check
      // the parent of this node of a match
      if(indirectObject.type === TokenTypes.attribute && token.type === TokenTypes.attribute) {
        potentialParent = indirectObject.parent;
      }

      if(indirectObject.type === TokenTypes.attribute && token.type !== TokenTypes.attribute) {
        indirectObject = token;
        roots.push(indirectObject);
      }
      // the only valid child of an entity is an attribute, if the parent is an entity and
      // the child is not an attribute, then this must be related to the directObject
      else if(potentialParent.type === TokenTypes.entity && token.type !== TokenTypes.attribute) {
        directObject.children.push(token);
        token.relationship = determineRelationship(directObject, token);
        token.parent = directObject;
        indirectObject = token;
      }
      else {
        let cursorRel = determineRelationship(potentialParent, token);
        let rootRel = determineRelationship(directObject, token);
        // if this token is an entity and either the directObject or indirectObject has a direct relationship
        // we don't really want to use that as it's most likely meant to filter a set down
        // instead of reduce the set to exactly one member.
        if(token.type === TokenTypes.entity) {
          if(cursorRel && cursorRel.distance === 0) cursorRel = null;
          if(rootRel && rootRel.distance === 0) rootRel = null;
        }
        if(!cursorRel) {
          directObject.children.push(token);
          token.relationship = rootRel;
          token.parent = directObject;
        } else if(!rootRel) {
          potentialParent.children.push(token);
          token.relationship = cursorRel;
          token.parent = potentialParent;
        } else if(cursorRel.distance <= rootRel.distance) {
          potentialParent.children.push(token);
          token.relationship = cursorRel;
          token.parent = potentialParent;
        } else {
          // @TODO: maybe if there's a cursorRel we should just always ignore the rootRel even if it
          // is a "better" relationship. Sentence structure-wise it seems pretty likely that attributes
          // following an entity are related to that entity and not something else.
          directObject.children.push(token);
          token.relationship = rootRel;
          token.parent = directObject;
        }
        indirectObject = token;
      }
    }

  }

  return tree;
}

//---------------------------------------------------------
// Query plans
//---------------------------------------------------------

enum StepTypes {
  find,
  gather,
  lookup,
  filterByEntity,
  intersect,
  calculate,
  aggregate,
  filter,
  sort,
  limit,
  group,
}

function ignoreHiddenCollections(colls) {
  for(let coll of colls) {
    if(coll !== "generic related to") {
      return coll;
    }
  }
}

function nodeToPlanSteps(node, parent, parentPlan) {
  //TODO: figure out what to do with operations
  let id = node.id || uuid();
  let {deselected} = node;
  let rel = node.relationship;
  if(parent && rel) {
    switch(rel.type) {
      case RelationshipTypes.collectionToAttribute:
        var plan = [];
        var curParent = parentPlan;
        for(let node of rel.nodes) {
          let coll = ignoreHiddenCollections(node);
          let item = {type: StepTypes.gather, relatedTo: curParent, subject: coll, id: uuid()};
          plan.push(item);
          curParent = item;
        }
        plan.push({type: StepTypes.lookup, relatedTo: curParent, subject: node.found, id, deselected});
        return plan;
        break;
      case RelationshipTypes.collectionToEntity:
        var plan = [];
        var curParent = parentPlan;
        for(let node of rel.nodes) {
          let coll = ignoreHiddenCollections(node);
          let item = {type: StepTypes.gather, relatedTo: curParent, subject: coll, id: uuid()};
          plan.push(item);
          curParent = item;
        }
        plan.push({type: StepTypes.filterByEntity, relatedTo: curParent, subject: node.found, id, deselected});
        return plan;
        break;
      case RelationshipTypes.collectionToCollection:
        return [{type: StepTypes.gather, relatedTo: parentPlan, subject: node.found, id, deselected}];
        break;
      case RelationshipTypes.collectionIntersection:
        return [{type: StepTypes.intersect, relatedTo: parentPlan, subject: node.found, id, deselected}];
        break;
      case RelationshipTypes.entityToAttribute:
        if(rel.distance === 0) {
          return [{type: StepTypes.lookup, relatedTo: parentPlan, subject: node.found, id, deselected}];
        } else {
          let plan = [];
          let curParent = parentPlan;
          for(let node of rel.nodes) {
            let coll = ignoreHiddenCollections(node);
            let item = {type: StepTypes.gather, relatedTo: curParent, subject: coll, id: uuid()};
            plan.push(item);
            curParent = item;
          }
          plan.push({type: StepTypes.lookup, relatedTo: curParent, subject: node.found, id, deselected});
          return plan;
        }
        break;
    }
  } else {
    if(node.type === TokenTypes.collection) {
      return [{type: StepTypes.gather, subject: node.found, id, deselected}];
    } else if(node.type === TokenTypes.entity) {
      return [{type: StepTypes.find, subject: node.found, id, deselected}];
    } else if(node.type === TokenTypes.attribute) {
      return [{type: StepTypes.lookup, subject: node.found, id, deselected}];
    }
    return [];
  }
}

function nodeToPlan(tree, parent = null, parentPlan = null) {
  if(!tree) return [];
  let plan = [];
  //process you, then your children
  plan.push.apply(plan, nodeToPlanSteps(tree, parent, parentPlan));
  let neueParentPlan = plan[plan.length - 1];
  for(let child of tree.children) {
    plan.push.apply(plan, nodeToPlan(child, tree, neueParentPlan));
  }
  return plan;
}

function groupsToPlan(nodes) {
  if(!nodes.length) return [];
  let groups = [];
  for(let node of nodes) {
    if(node.type === "collection") {
      groups.push([node.id, "entity"]);
    } else if(node.type === "attribute") {
      groups.push([node.id, "value"]);
    } else {
      throw new Error("Invalid node to group on: " + JSON.stringify(nodes));
    }
  }
  return [{type: "group", id: uuid(), groups, groupNodes: nodes}];
}

// Since intermediate plan steps can end up duplicated, we need to walk the plan to find
// nodes that are exactly the same and only do them once. E.g. salaries per department and age
// will bring in two employee gathers.
function dedupePlan(plan) {
  let dupes = {};
  // for every node in the plan backwards
  for(let planIx = plan.length - 1; planIx > -1; planIx--) {
    let step = plan[planIx];
    // check all preceding nodes for a node that is equivalent
    for(let dupeIx = planIx - 1; dupeIx > -1;  dupeIx--) {
      let dupe = plan[dupeIx];
      // equivalency requires the same type, subject, deselect, and parent
      if(step.type === dupe.type && step.subject === dupe.subject && step.deselected === dupe.deselected && step.relatedTo === dupe.relatedTo) {
        // store the dupe and what node will replace it
        dupes[step.id] = dupe.id;
      }
    }
  }
  return plan.filter((step) => {
    // remove anything we found to be a dupe
    if(dupes[step.id]) return false;
    // if this step references a dupe, relate it to the new node
    if(dupes[step.relatedTo]) {
      step.relatedTo = dupes[step.relatedTo];
    }
    return true;
  })
}

function treeToPlan(tree) {
  let plan = [];
  for(let root of tree.roots) {
    plan = plan.concat(nodeToPlan(root));
  }
  plan = dedupePlan(plan);
  for(let group of tree.groups) {
    plan.push({type: StepTypes.group, subject: group.found, subjectNode: group});
  }
  return plan;
}

//---------------------------------------------------------
// Test queries
//---------------------------------------------------------

function validateStep(step, expected) {
  if(!step || step.type !== expected.type || step.subject !== expected.subject || step.deselected !== expected.deselected) {
    return false;
  }
  return true;
}

function validatePlan(plan, expected) {
  let ix = 0;
  for(let exStep of expected) {
    let step = plan[ix];
    if(!validateStep(step, exStep)) return false;
    ix++;
  }
  return true;
}

var tests = {
  "chris granger's age": {
    expected: [{type: StepTypes.find, subject: "chris granger"}, {type: StepTypes.lookup, subject: "age"}],
  },
  "robert attorri's age": {
    expected: [{type: StepTypes.find, subject: "robert attorri"}, {type: StepTypes.lookup, subject: "age"}]
  },
  "people older than chris granger": {

  },
  "people whose age < 30": {

  },
  "people whose age < chris granger's age": {

  },
  "people whose age < chris granger's": {

  },
  "people older than chris granger and younger than edward norton": {

  },
  "people between 50 and 65 years old": {

  },
  "people whose age is between 50 and 65": {

  },
  "people who are 50-65 years old": {

  },
  "people older than chris granger's spouse": {

  },
  "people older than their spouse": {

  },
  "people who are either heads or spouses of heads": {

  },
  "people who have a hair color of red or black": {

  },
  "people who have neither attended a meeting nor had a one-on-one": {

  },
  "salaries per department": {
    expected: [{type: StepTypes.gather, subject: "department"}, {type: StepTypes.gather, subject: "employee"}, {type: StepTypes.lookup, subject: "salary"}, {type: StepTypes.group, subject: "department"}]
  },
  "salaries per department and age": {
    expected: [{type: StepTypes.gather, subject: "department"}, {type: StepTypes.gather, subject: "employee"}, {type: StepTypes.lookup, subject: "salary"}, {type: StepTypes.lookup, subject: "age"}, {type: StepTypes.group, subject: "department"}, {type: StepTypes.group, subject: "age"}]
  },
  "salaries per department, employee, and age": {
    expected: [{type: StepTypes.gather, subject: "department"}, {type: StepTypes.gather, subject: "employee"}, {type: StepTypes.lookup, subject: "salary"}, {type: StepTypes.lookup, subject: "age"}, {type: StepTypes.group, subject: "department"}, {type: StepTypes.group, subject: "employee"}, {type: StepTypes.group, subject: "age"}]
  },
  "sum of the salaries per department": {
    expected: [{type: StepTypes.gather, subject: "department"}, {type: StepTypes.gather, subject: "employee"}, {type: StepTypes.lookup, subject: "salary"}, {type: StepTypes.group, subject: "department"}, {type: StepTypes.aggregate, subject: "sum", args: ["salary"]}]
  },
  "top 2 salaries per department": {

  },
  "sum of the top 2 salaries per department": {

  },
  "departments where all the employees are male": {

  },
  "departments where all the employees are over-40 males": {

  },
  "employees whose sales are greater than their salary": {

  },
  "count employees and their spouses": {

  },
  "dishes with eggs and chicken": {
    expected: [{type: StepTypes.gather, subject: "dish"}, {type: StepTypes.filterByEntity, subject: "egg"}, {type: StepTypes.filterByEntity, subject: "chicken"}]
  },
  "dishes with eggs or chicken": {

  },
  "dishes without eggs and chicken": {

  },
  "dishes without eggs or chicken": {
    expected: [{type: StepTypes.gather, subject: "dish"}, {type: StepTypes.filterByEntity, subject: "egg", deselected: true}, {type: StepTypes.filterByEntity, subject: "chicken", deselected: true}]
  },
  "dishes with eggs that aren't desserts": {
    expected: [{type: StepTypes.gather, subject: "dish"}, {type: StepTypes.filterByEntity, subject: "egg"}, {type: StepTypes.intersect, subject: "dessert", deselected: true}]
  },
  "dishes that don't have eggs or chicken": {
    expected: [{type: StepTypes.gather, subject: "dish"}, {type: StepTypes.filterByEntity, subject: "egg", deselected: true}, {type: StepTypes.filterByEntity, subject: "chicken", deselected: true}]
  },
  "dishes with a cook time < 30 that have eggs and are sweet": {

  },
  "dishes that take 30 minutes to an hour": {

  },
  "dishes that take 30-60 minutes": {

  },

  "people who live alone": {

  },

  "everyone in this room speaks at least two languages": {

  },
  "at least two languages are spoken by everyone in this room": {

  },


  "friends older than the average age of people with pets": {

  },

  "meetings john was in in the last 10 days": {

  },

  "parts that have a color of \"red\", \"green\", \"blue\", or \"yellow\"": {

  },

  "per book get the average price of books(2) that are cheaper": {

  },
  "per book get the average price of books(2) that cost less": {

  },
  "per book get the average price of books(2) where books(2) price < book price": {

  },

  "head's last name = employee's last name and head != employee and head's department = employee's department": {

  },

  "person loves person(2) and person(2) loves person(3) and person(3) loves person": {

  },

  "employee salary / employee's department total cost ": {

  },

  "Return the average number of publications by Bob in each year": {

  },
  "Return authors who have more papers than Bob in VLDB after 2000": {

  },
  "Return the conference in each area whose papers have the most total citations": {

  },
  "return all conferences in the database area": {

  },
  "return all the organizations, where the number of papers by the organization is more than the number of authors in IBM": {

  },
  "return all the authors, where the number of papers by the author in VLDB is more than the number of papers in ICDE": {

  },
  "Where are the restaurants in San Francisco that serve good French food?": {

  },
  "What are the population sizes of cities that are located in California?": {

  },
  "What are the names of rivers in the state that has the largest city in the united states of america?": {

  },
  "What is the average elevation of the highest points in each state?": {

  },
  "What jobs as a senior software developer are available in houston but not san antonio?": {

  },
}

//---------------------------------------------------------
// Debug drawing
//---------------------------------------------------------

function groupTree(root) {
  if(root.type === TokenTypes.text) return;
  let kids = root.children.map(groupTree);
  let relationship = "root";
  let unfound = "";
  let distance = "";
  let nodes = "";
  if(root.relationship) {
    relationship = RelationshipTypes[root.relationship.type];
    unfound = root.relationship.unfound ? " (unfound)" : unfound;
    distance = ` (${root.relationship.distance})`;
    if(root.relationship.nodes && root.relationship.nodes.length) {
      nodes = ` (${root.relationship.nodes.map((nodes) => nodes[0]).join(", ")})`;
    }
  }

  return {c: "", children: [
    {c: `node ${TokenTypes[root.type]}`, text: `${root.found} (${relationship})${unfound}${distance}${nodes}`},
    {c: "kids", children: kids},
  ]};
}

function testSearch(search, info) {
  let start = performance.now();
  let tokens = getTokens(search);
  let tree = tokensToTree(tokens);
  let plan = treeToPlan(tree);
  let valid;
  let expectedPlan:any;
  if(info.expected) {
    let expected = info.expected;
    valid = validatePlan(plan, expected);
    expectedPlan = expected.map((step, ix): any => {
        let actual = plan[ix];
        let validStep = "";
        let deselected = step.deselected ? "!" : "";
        if(!actual) {
          return {state: "missing", message: `${StepTypes[step.type]} ${deselected}${step.subject}`};
        }
        if(validateStep(actual, step)) {
          return {state: "valid", message: "valid"};
        } else {
          return {state: "invalid", message: `${StepTypes[step.type]} ${deselected}${step.subject}`};
        }
      })
  }
  return {tokens, tree, plan, valid, validated: !!info.expected, expectedPlan, search, time: performance.now() - start};
}

function searchResultUi(result) {
  let {tokens, tree, plan, valid, validated, expectedPlan, search} = result;
  //tokens
  let tokensNode = {c: "tokens", children: [
    {c: "header", text: "Tokens"},
    {c: "kids", children: tokens.map((token) => {
      return {c: `node ${TokenTypes[token.type]}`, text: `${token.found} (${TokenTypes[token.type]})`}
    })}
  ]};

  //tree
  let treeNode = {c: "tree", children: [
    {c: "header", text: "Tree"},
    {c: "kids", children: [
      {c: "header2", text: "Roots"},
      {c: "kids", children: tree.roots.map(groupTree)},
      {c: "header2", text: "Operations"},
      {c: "kids", children: tree.operations.map(groupTree)},
      {c: "header2", text: "Groups"},
      {c: "kids", children: tree.groups.map((root) => {
        return {c: `node ${TokenTypes[root.type]}`, text: `${root.found}`};
      })},
    ]}
  ]};

  //tokens
  let planNode;
  let klass = "";
  if(validated) {
    if(!valid) klass += "failed";
    else klass += "succeeded";

    planNode = {c: "tokens", children: [
      {c: "header", text: "Plan"},
      {c: "kids", children: expectedPlan.map((info, ix) => {
        let actual = plan[ix];
        let message = "";
        if(info.state !== "valid") {
          message = ` :: expected ${info.message}`;
          if(info.state === "missing") {
            return {c: `step ${info.state}`, text: `none ${message}`};
          }
        }
        return {c: `step ${info.state}`, text: `${StepTypes[actual.type]} ${actual.deselected ? "!" : ""}${actual.subject}${message}`};
      })}
    ]};
  } else {
    planNode = {c: "tokens", children: [
      {c: "header", text: "Plan"},
      {c: "kids", children: plan.map((step) => {
        let deselected = step.deselected ? "!" : "";
        return {c: "node", text: `${StepTypes[step.type]} ${deselected}${step.subject}`}
      })}
    ]};
  }

  return {c: `search ${klass}`, children: [
    {c: "search-header", text: `${search}`},

    tokensNode,
    treeNode,
    planNode,
    {c: "tokens", children: [
      {c: "header", text: "Performance"},
      {c: "kids", children: [
        {c: "time", text: `Total: ${result.time.toFixed(2)}ms`},
      ]}
    ]}
  ]};
}



function root() {
  let results = [];
  let resultStats = {unvalidated: 0, succeeded: 0, failed: 0};
  for(let test in tests) {
    let result = testSearch(test, tests[test]);
    results.push(result);
    if(!result.validated) {
      resultStats.unvalidated++;
    } else if(result.valid === false) {
      resultStats.failed++;
    } else {
      resultStats.succeeded++;
    }
  }
  let resultItems = results.map(searchResultUi);
  return {id: "root", c: "test-root", children: [
    {c: "stats row", children: [
      {c: "failed", text: resultStats.failed},
      {c: "succeeded", text: resultStats.succeeded},
      {c: "unvalidated", text: resultStats.unvalidated},
    ]},
    {children: resultItems}
  ]};
}

wiki.coerceInput("foo");
app.renderRoots["wiki"] = root;

//---------------------------------------------------------
// Utils
//---------------------------------------------------------

function arrayIntersect(a, b) {
  let ai = 0;
  let bi = 0;
  let result = [];
  while(ai < a.length && bi < b.length){
      if (a[ai] < b[bi] ) ai++;
      else if (a[ai] > b[bi] ) bi++;
      else {
        result.push(a[ai]);
        ai++;
        bi++;
      }
  }
  return result;
}