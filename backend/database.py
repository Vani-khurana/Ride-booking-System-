from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# The Supabase Connection String.
# ⚠️ ACTION REQUIRED: You must replace [YOUR-PASSWORD] with your actual Supabase password before this code will work!
SQLALCHEMY_DATABASE_URL = "postgresql://postgres.tifiqfvvehtxljojcmmt:FuckinGExotiC%40@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"

# Engine configured for PostgreSQL
engine = create_engine(SQLALCHEMY_DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# DB Dependency for routing
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
